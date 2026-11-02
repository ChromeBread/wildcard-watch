#!/usr/bin/env python3
"""Refresh data/live.json, data/streams.json and data/avatars.json.

Env: YOUTUBE_API_KEY, TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET.
A platform whose credentials are missing is skipped; it never wipes existing data.
"""
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
AVATAR_MAX_AGE = timedelta(hours=24)


def now_utc():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def http_json(url, headers=None, data=None):
    req = urllib.request.Request(url, headers={"User-Agent": "wildcard-watch", **(headers or {})}, data=data)
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.load(res)


def read_json(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def chunks(items, size):
    for i in range(0, len(items), size):
        yield items[i:i + size]


# --- YouTube -----------------------------------------------------------------

def yt(path, key, **params):
    qs = urllib.parse.urlencode({**params, "key": key})
    return http_json(f"https://www.googleapis.com/youtube/v3/{path}?{qs}")


def fetch_youtube(members, streams, ignored, since, key):
    """Return (live_or_upcoming, finished) entries; updates `ignored` with non-stream videos."""
    owner = {}
    for m in members:
        uploads = "UU" + m["youtube"][2:]
        try:
            items = yt("playlistItems", key, part="contentDetails", playlistId=uploads, maxResults=50)["items"]
        except urllib.error.HTTPError as e:
            print(f"youtube: {m['id']}: HTTP {e.code}", file=sys.stderr)
            continue
        for item in items:
            published = item["contentDetails"].get("videoPublishedAt")
            # Scheduled broadcasts can have no publish time yet; broadcast times are checked below.
            if not published or parse_iso(published) >= since:
                owner[item["contentDetails"]["videoId"]] = m["id"]

    tracked = {s["id"][3:]: s for s in streams.values() if s["platform"] == "youtube" and not s.get("endedAt")}
    wanted = [v for v in owner if v not in ignored and f"yt:{v}" not in streams]
    wanted += list(tracked)
    active, finished, returned = [], [], set()
    for ids in chunks(wanted, 50):
        for v in yt("videos", key, part="snippet,liveStreamingDetails", id=",".join(ids))["items"]:
            vid = v["id"]
            returned.add(vid)
            live = v.get("liveStreamingDetails")
            if not live:
                ignored.add(vid)
                continue
            state = v["snippet"].get("liveBroadcastContent")
            member = owner.get(vid) or tracked[vid]["member"]
            entry = {
                "id": f"yt:{vid}",
                "platform": "youtube",
                "member": member,
                "title": v["snippet"]["title"],
                "url": f"https://www.youtube.com/watch?v={vid}",
                "thumb": f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg",
                "startedAt": live.get("actualStartTime") or live.get("scheduledStartTime"),
            }
            if state == "live":
                active.append({**entry, "state": "live"})
            elif state == "upcoming":
                active.append({**entry, "state": "upcoming"})
            elif live.get("actualStartTime") and parse_iso(live["actualStartTime"]) >= since:
                finished.append({**entry, "endedAt": live.get("actualEndTime") or iso(now_utc())})
            else:
                ignored.add(vid)  # aired before the reveal, or cancelled without ever airing

    # Older ids can no longer come back from the uploads list, so the file stays small.
    ignored.intersection_update(owner)

    # A tracked broadcast that vanished was deleted or made private.
    for vid, s in tracked.items():
        if vid not in returned:
            finished.append({**s, "endedAt": iso(now_utc())})
    return active, finished


# --- Twitch ------------------------------------------------------------------

def parse_twitch_duration(text):
    m = re.fullmatch(r"(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?", text)
    h, mi, s = (int(x or 0) for x in m.groups())
    return h * 3600 + mi * 60 + s


def fetch_twitch(members, streams, since, client_id, client_secret):
    body = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "client_credentials",
    }).encode()
    token = http_json("https://id.twitch.tv/oauth2/token", data=body)["access_token"]
    headers = {"Client-Id": client_id, "Authorization": f"Bearer {token}"}

    def helix(path, params):
        return http_json(f"https://api.twitch.tv/helix/{path}?{urllib.parse.urlencode(params, doseq=True)}", headers)["data"]

    logins = {m["twitch"].lower(): m["id"] for m in members}
    users = {}
    for batch in chunks(list(logins), 100):
        for u in helix("users", {"login": batch}):
            users[u["id"]] = logins[u["login"].lower()]
    for login, mid in logins.items():
        if mid not in users.values():
            print(f"twitch: unknown login {login}", file=sys.stderr)

    active = []
    live_ids = set()
    for batch in chunks(list(users), 100):
        for s in helix("streams", {"user_id": batch, "first": 100}):
            live_ids.add(s["id"])
            active.append({
                "id": f"tw:{s['id']}",
                "platform": "twitch",
                "member": users[s["user_id"]],
                "title": s["title"],
                "game": s.get("game_name") or "",
                "url": f"https://www.twitch.tv/{s['user_login']}",
                "thumb": s["thumbnail_url"].replace("{width}", "320").replace("{height}", "180"),
                "startedAt": s["started_at"],
                "state": "live",
            })

    finished = []
    for uid, mid in users.items():
        for v in helix("videos", {"user_id": uid, "type": "archive", "first": 50}):
            created = parse_iso(v["created_at"])
            if created < since or not v.get("stream_id") or v["stream_id"] in live_ids:
                continue
            ended = created + timedelta(seconds=parse_twitch_duration(v["duration"]))
            finished.append({
                "id": f"tw:{v['stream_id']}",
                "platform": "twitch",
                "member": mid,
                "title": v["title"],
                "url": v["url"],
                "thumb": v["thumbnail_url"].replace("%{width}", "320").replace("%{height}", "180"),
                "startedAt": v["created_at"],
                "endedAt": iso(ended),
            })

    # Streams without a saved VOD: keep the record and close it now.
    closed = {f["id"] for f in finished}
    for s in streams.values():
        if s["platform"] == "twitch" and not s.get("endedAt") and s["id"] not in closed and s["id"][3:] not in live_ids:
            finished.append({**s, "endedAt": iso(now_utc())})
    return active, finished


# --- CHZZK -------------------------------------------------------------------

KST = timezone(timedelta(hours=9))


def fetch_chzzk(members, since):
    """Return (live, replays). Only replays enter the archive: live ids and replay ids differ."""
    base = "https://api.chzzk.naver.com/service"
    headers = {"User-Agent": "Mozilla/5.0"}
    active, finished = [], []
    for m in members:
        channel = m["chzzk"]
        live = http_json(f"{base}/v2/channels/{channel}/live-detail", headers)["content"]
        if live and live.get("status") == "OPEN":
            opened = datetime.fromisoformat(live["openDate"]).replace(tzinfo=KST)
            active.append({
                "id": f"cz:live{live['liveId']}",
                "platform": "chzzk",
                "member": m["id"],
                "title": live["liveTitle"],
                "url": f"https://chzzk.naver.com/live/{channel}",
                "thumb": (live.get("liveImageUrl") or "").replace("{type}", "480") or None,
                "startedAt": iso(opened.astimezone(timezone.utc)),
                "state": "live",
            })
        query = "sortType=LATEST&pagingType=PAGE&page=0&size=50"
        for v in http_json(f"{base}/v1/channels/{channel}/videos?{query}", headers)["content"]["data"]:
            if v.get("videoType") != "REPLAY":
                continue
            ended = datetime.fromtimestamp(v["publishDateAt"] / 1000, timezone.utc)
            started = ended - timedelta(seconds=v["duration"])
            if started >= since:
                finished.append({
                    "id": f"cz:{v['videoNo']}",
                    "platform": "chzzk",
                    "member": m["id"],
                    "title": v["videoTitle"],
                    "url": f"https://chzzk.naver.com/video/{v['videoNo']}",
                    "thumb": v.get("thumbnailImageUrl"),
                    "startedAt": iso(started),
                    "endedAt": iso(ended),
                })
    return active, finished


# --- Avatars -----------------------------------------------------------------

def refresh_avatars(members, avatars):
    """Twitter profile image URLs change when a member changes icon, so re-resolve daily."""
    last = avatars.get("updatedAt")
    if last and now_utc() - parse_iso(last) < AVATAR_MAX_AGE:
        return avatars
    urls = dict(avatars.get("urls", {}))
    for m in members:
        try:
            user = http_json(f"https://api.fxtwitter.com/{m['x']}")["user"]
            urls[m["id"]] = user["avatar_url"].replace("_normal.", "_400x400.")
        except (urllib.error.URLError, KeyError, TimeoutError, ValueError) as e:
            print(f"avatar: {m['id']}: {e}", file=sys.stderr)
        time.sleep(0.3)
    return {"updatedAt": iso(now_utc()), "urls": urls}


# --- Merge -------------------------------------------------------------------

def apply_results(store, active, finished):
    """Merge fetched entries into the archive. Upcoming entries stay out of the archive."""
    for s in active:
        if s["state"] == "live":
            store[s["id"]] = {k: v for k, v in s.items() if k != "state"}
    for s in finished:
        store[s["id"]] = {k: v for k, v in s.items() if k != "state"}


def main():
    config = read_json(DATA / "members.json", None)
    since = parse_iso(config["announcedAt"])
    members = config["members"]

    archive = read_json(DATA / "streams.json", {"streams": [], "ignored": []})
    store = {s["id"]: s for s in archive["streams"]}
    ignored = set(archive["ignored"])
    previous = read_json(DATA / "live.json", {})
    result = {key: previous.get(key, []) for key in ("youtube", "twitch", "chzzk")}
    failed = False

    key = os.environ.get("YOUTUBE_API_KEY")
    if key:
        try:
            active, finished = fetch_youtube([m for m in members if m.get("youtube")], store, ignored, since, key)
            apply_results(store, active, finished)
            result["youtube"] = active
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"youtube failed: {e}", file=sys.stderr)
            failed = True
    else:
        print("youtube skipped: YOUTUBE_API_KEY is not set", file=sys.stderr)

    client_id, secret = os.environ.get("TWITCH_CLIENT_ID"), os.environ.get("TWITCH_CLIENT_SECRET")
    if client_id and secret:
        try:
            active, finished = fetch_twitch([m for m in members if m.get("twitch")], store, since, client_id, secret)
            apply_results(store, active, finished)
            result["twitch"] = active
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"twitch failed: {e}", file=sys.stderr)
            failed = True
    else:
        print("twitch skipped: TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET are not set", file=sys.stderr)

    try:
        active, finished = fetch_chzzk([m for m in members if m.get("chzzk")], since)
        apply_results(store, [], finished)
        result["chzzk"] = active
    except (urllib.error.URLError, TimeoutError, KeyError, ValueError) as e:
        print(f"chzzk failed: {e}", file=sys.stderr)
        failed = True

    write_json(DATA / "streams.json", {
        "streams": sorted(store.values(), key=lambda s: s["startedAt"], reverse=True),
        "ignored": sorted(ignored),
    })
    # checkedAt lives in its own file: it changes every run and must not trigger a commit.
    write_json(DATA / "live.json", result)
    write_json(DATA / "status.json", {"checkedAt": iso(now_utc()), "youtube": bool(key), "twitch": bool(client_id and secret)})
    write_json(DATA / "avatars.json", refresh_avatars(members, read_json(DATA / "avatars.json", {})))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
