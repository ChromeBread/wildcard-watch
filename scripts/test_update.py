"""Run: python -m unittest discover scripts"""
import sys
import pathlib
import unittest
from datetime import datetime, timezone
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import update  # noqa: E402

SINCE = datetime(2026, 10, 29, tzinfo=timezone.utc)
MEMBER = {"id": "doki", "youtube": "UCabc", "twitch": "dokibird"}


def yt_video(vid, state, live=None):
    video = {"id": vid, "snippet": {"title": vid, "liveBroadcastContent": state}}
    if live is not None:
        video["liveStreamingDetails"] = live
    return video


def fake_yt(ids, videos):
    def call(path, key, **params):
        if path == "playlistItems":
            return {"items": [{"contentDetails": {"videoId": v, "videoPublishedAt": d}} for v, d in ids]}
        return {"items": [v for v in videos if v["id"] in params["id"].split(",")]}
    return call


class YouTube(unittest.TestCase):
    def run_fetch(self, ids, videos, streams=None, ignored=None):
        ignored = set() if ignored is None else ignored
        with mock.patch.object(update, "yt", fake_yt(ids, videos)):
            active, finished = update.fetch_youtube([MEMBER], streams or {}, ignored, SINCE, "k")
        return active, finished, ignored

    def test_classifies_live_upcoming_finished_and_plain_upload(self):
        new = "2026-11-01T00:00:00Z"
        active, finished, ignored = self.run_fetch(
            [("a", new), ("b", new), ("c", new), ("d", new)],
            [
                yt_video("a", "live", {"actualStartTime": new}),
                yt_video("b", "upcoming", {"scheduledStartTime": new}),
                yt_video("c", "none", {"actualStartTime": new, "actualEndTime": "2026-11-01T02:00:00Z"}),
                yt_video("d", "none"),
            ],
        )
        self.assertEqual({(s["id"], s["state"]) for s in active}, {("yt:a", "live"), ("yt:b", "upcoming")})
        self.assertEqual([s["id"] for s in finished], ["yt:c"])
        self.assertEqual(ignored, {"d"})

    def test_videos_before_the_announcement_are_not_requested(self):
        active, finished, _ = self.run_fetch(
            [("old", "2026-10-01T00:00:00Z")],
            [yt_video("old", "none", {"actualStartTime": "2026-10-01T00:00:00Z"})],
        )
        self.assertEqual((active, finished), ([], []))

    def test_scheduled_broadcast_without_publish_time_is_upcoming(self):
        active, _, _ = self.run_fetch([("s", None)], [yt_video("s", "upcoming", {"scheduledStartTime": "2026-11-05T00:00:00Z"})])
        self.assertEqual([(a["id"], a["state"]) for a in active], [("yt:s", "upcoming")])

    def test_broadcast_that_aired_before_the_reveal_is_ignored(self):
        old = "2026-10-01T00:00:00Z"
        _, finished, ignored = self.run_fetch([("o", None)], [yt_video("o", "none", {"actualStartTime": old})])
        self.assertEqual((finished, ignored), ([], {"o"}))

    def test_ignored_ids_no_longer_listed_are_dropped(self):
        _, _, ignored = self.run_fetch([], [], ignored={"gone"})
        self.assertEqual(ignored, set())

    def test_live_stream_that_vanished_is_closed(self):
        tracked = {"yt:x": {"id": "yt:x", "platform": "youtube", "member": "doki", "startedAt": "2026-11-01T00:00:00Z"}}
        _, finished, _ = self.run_fetch([], [], streams=tracked)
        self.assertEqual(finished[0]["id"], "yt:x")
        self.assertIn("endedAt", finished[0])


class Twitch(unittest.TestCase):
    def fetch(self, live, vods, streams=None):
        def http(url, headers=None, data=None):
            if "oauth2" in url:
                return {"access_token": "t"}
            if "/users" in url:
                return {"data": [{"id": "1", "login": "dokibird"}]}
            if "/streams" in url:
                return {"data": live}
            return {"data": vods}
        with mock.patch.object(update, "http_json", http):
            return update.fetch_twitch([MEMBER], streams or {}, SINCE, "id", "secret")

    def test_running_stream_is_live_and_its_vod_is_not_finished(self):
        live = [{"id": "9", "user_id": "1", "user_login": "dokibird", "title": "t", "thumbnail_url": "x-{width}x{height}", "started_at": "2026-11-01T00:00:00Z"}]
        vod = [{"stream_id": "9", "title": "t", "url": "u", "thumbnail_url": "x", "created_at": "2026-11-01T00:00:00Z", "duration": "1h"}]
        active, finished = self.fetch(live, vod)
        self.assertEqual([s["id"] for s in active], ["tw:9"])
        self.assertEqual(finished, [])

    def test_vod_end_time_comes_from_duration(self):
        vod = [{"stream_id": "9", "title": "t", "url": "u", "thumbnail_url": "x", "created_at": "2026-11-01T00:00:00Z", "duration": "1h2m3s"}]
        _, finished = self.fetch([], vod)
        self.assertEqual(finished[0]["endedAt"], "2026-11-01T01:02:03Z")

    def test_ended_stream_without_vod_is_kept_and_closed(self):
        known = {"tw:7": {"id": "tw:7", "platform": "twitch", "member": "doki", "startedAt": "2026-11-01T00:00:00Z"}}
        _, finished = self.fetch([], [], known)
        self.assertEqual(finished[0]["id"], "tw:7")
        self.assertIn("endedAt", finished[0])


class Chzzk(unittest.TestCase):
    def fetch(self, live, videos):
        def http(url, headers=None, data=None):
            return {"content": live if "live-detail" in url else {"data": videos}}
        with mock.patch.object(update, "http_json", http):
            return update.fetch_chzzk([{"id": "terri", "chzzk": "c"}], SINCE)

    def test_open_stream_is_live_and_kst_becomes_utc(self):
        active, _ = self.fetch({"status": "OPEN", "liveId": 1, "liveTitle": "t", "openDate": "2026-11-02 19:00:00", "liveImageUrl": "x_{type}.jpg"}, [])
        self.assertEqual(active[0]["startedAt"], "2026-11-02T10:00:00Z")
        self.assertEqual(active[0]["thumb"], "x_480.jpg")

    def test_closed_stream_is_not_live(self):
        self.assertEqual(self.fetch({"status": "CLOSE"}, [])[0], [])

    def test_replays_after_the_reveal_are_kept_and_others_dropped(self):
        ended = int(datetime(2026, 11, 2, tzinfo=timezone.utc).timestamp() * 1000)
        video = {"videoNo": 5, "videoTitle": "t", "publishDateAt": ended, "duration": 3600, "videoType": "REPLAY"}
        _, finished = self.fetch(None, [video, {**video, "videoNo": 6, "videoType": "UPLOAD"}, {**video, "videoNo": 7, "publishDateAt": 0}])
        self.assertEqual([(v["id"], v["startedAt"]) for v in finished], [("cz:5", "2026-11-01T23:00:00Z")])


class Merge(unittest.TestCase):
    def test_upcoming_stays_out_of_archive(self):
        store = {}
        update.apply_results(store, [{"id": "a", "state": "upcoming"}, {"id": "b", "state": "live"}], [])
        self.assertEqual(list(store), ["b"])
        self.assertNotIn("state", store["b"])


if __name__ == "__main__":
    unittest.main()
