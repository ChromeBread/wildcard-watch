"use strict";

const REFRESH_MS = 60_000;
const STALE_MS = 45 * 60_000;
const SHORT_TEAM = { amalee: "AmaLee", dokibird: "Dokibird", ironmouse: "ironmouse", rin: "Rin" };

const WATCHED_KEY = "ww-watched";
const MAX_HEARTS = 30;
const X_LOGO = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';

const LANG_KEY = "ww-lang";

const STRINGS = {
  en: {
    locale: "en-US",
    title: "Wildcard Watch (Unofficial)",
    description: "An unofficial fan page tracking who in The Wildcard Club is live, and what they sound like.",
    unofficial: "Unofficial",
    teams: "Teams",
    liveNow: (n) => `${n} live now`,
    nobodyLive: "No one is live right now",
    memberLive: (name) => `${name} is live`,
    teamLive: (name, n) => `${name}, ${n} live`,
    draw: "🃏 Draw a card",
    drawAgain: "Draw another",
    listen: "♪ Listen",
    viewMember: "View member",
    noStreams: "No streams recorded since the member reveal yet",
    sendHeart: (name) => `Send a heart to ${name}`,
    birthday: (date) => `Birthday ${date}`,
    xOf: (name) => `${name} on X`,
    listenTo: (title) => `Listen: ${title}`,
    streamsOn: (platform) => `${platform} streams`,
    channel: "Channel",
    count: (n) => (n === 1 ? "1 stream" : `${n} streams`),
    upcomingAt: (time, title) => `Upcoming ${time} ${title}`,
    liveSince: (time) => `Live since ${time}`,
    reveal: "Member reveal",
    startingSoon: "Starting soon",
    liveIn: (text) => `Live in ${text}`,
    hours: (n) => (n === 1 ? "1 hour" : `${n} hours`),
    days: (n) => (n === 1 ? "1 day" : `${n} days`),
    checked: (ago) => `Checked ${ago} (every 10 minutes)`,
    stale: "Updates are delayed",
    missing: (list) => `${list.join(", ")} not available`,
    disclaimer: ["An unofficial personal fan page, not affiliated with The Wildcard Club, STUDIO TANGRAM, HYBE, or any member. For the latest news, see the ", "official site", "."],
    privacy: "Watched marks stay in this browser on this device and are never sent anywhere.",
    loadFailed: "Could not load the data.",
    kinds: { original: "Original", cover: "Solo cover" },
    birthdayFormat: { month: "short", day: "numeric" },
    dateFormat: { weekday: "short", month: "short", day: "numeric" },
  },
  ja: {
    locale: "ja-JP",
    title: "Wildcard Watch（非公式）",
    description: "The Wildcard Club 参加メンバーの配信状況と歌声をまとめた非公式ファンページ",
    unofficial: "非公式",
    teams: "チーム",
    liveNow: (n) => `${n}人配信中`,
    nobodyLive: "今は誰も配信していないようです",
    memberLive: (name) => `${name} 配信中`,
    teamLive: (name, n) => `${name} ${n}人配信中`,
    draw: "🃏 カードを1枚引く",
    drawAgain: "もう1枚引く",
    listen: "♪ 歌を聴く",
    viewMember: "メンバーを見る",
    noStreams: "発表以降の配信はまだ記録がありません",
    sendHeart: (name) => `${name} にハートを送る`,
    birthday: (date) => `誕生日 ${date}`,
    xOf: (name) => `${name} のX`,
    listenTo: (title) => `歌を聴く: ${title}`,
    streamsOn: (platform) => `${platform}の配信`,
    channel: "チャンネル",
    count: (n) => `${n}件`,
    upcomingAt: (time, title) => `配信予定 ${time} ${title}`,
    liveSince: (time) => `${time} から配信中`,
    reveal: "メンバー発表",
    startingSoon: "まもなく開始",
    liveIn: (text) => `${text}後にライブ配信`,
    hours: (n) => `${n}時間`,
    days: (n) => `${n}日`,
    checked: (ago) => `最終確認 ${ago}（10分ごとに確認）`,
    stale: "更新が遅れています",
    missing: (list) => `${list.join("・")}は未取得`,
    disclaimer: ["個人による非公式ファンページです。The Wildcard Club、STUDIO TANGRAM、HYBE および各メンバーとは関係ありません。最新情報は", "公式サイト", "へ。"],
    privacy: "視聴済みの印はこの端末のブラウザ内だけに保存され、外部には送られません。",
    loadFailed: "データを読み込めませんでした。",
    kinds: { original: "オリジナル", cover: "ソロカバー" },
    birthdayFormat: { month: "numeric", day: "numeric" },
    dateFormat: { weekday: "short", month: "numeric", day: "numeric" },
  },
};

const $ = (selector) => document.querySelector(selector);

function readLang() {
  let saved = null;
  try {
    saved = localStorage.getItem(LANG_KEY);
  } catch {
    // storage blocked: fall through to the browser language
  }
  if (STRINGS[saved]) return saved;
  return navigator.language?.toLowerCase().startsWith("ja") ? "ja" : "en";
}

let lang = readLang();
let t = STRINGS[lang];

// Stays in this browser only: nothing is sent anywhere, and storage may be unavailable (private mode).
function readWatched() {
  try {
    return new Set(JSON.parse(localStorage.getItem(WATCHED_KEY)) ?? []);
  } catch {
    return new Set();
  }
}

function markWatched(id, node) {
  watched.add(id);
  node.classList.add("watched");
  try {
    localStorage.setItem(WATCHED_KEY, JSON.stringify([...watched]));
  } catch {
    // the mark still shows until the page is reloaded
  }
}

const watched = readWatched();
let config, members, teams;
let byId = new Map();
let avatars = {};
let streams = [];
let live = [];
let upcoming = [];
let status = null;
let snapshot = "";
let drawnId = null;

async function load(path) {
  try {
    // Revalidates with the server: unchanged files cost no download and add no cache entries.
    const res = await fetch(path, { cache: "no-cache" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

const external = (href, props, ...children) =>
  el("a", { href, target: "_blank", rel: "noopener", ...props }, ...children);

const teamStyle = (id) => `--team:var(--${id})`;
const isLive = (id) => live.some((s) => s.member === id);
const liveCount = (teamId) => members.filter((m) => m.team === teamId && isLive(m.id)).length;
const pill = () => el("span", { class: "pill" }, "LIVE");

function avatar(m, { showLive = true } = {}) {
  const on = showLive && isLive(m.id);
  const box = el("span", { class: `avatar${on ? " live" : ""}`, style: teamStyle(m.team) });
  const initial = () => box.replaceChildren(m.name[0].toUpperCase(), on ? pill() : "");
  const url = avatars[m.id];
  if (url) {
    const img = el("img", { src: url, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
    img.onerror = initial; // the image URL dies when the member changes icon
    box.append(img, on ? pill() : "");
  } else {
    initial();
  }
  return box;
}

// --- Time ---------------------------------------------------------------------

const clock = (iso) => new Date(iso).toLocaleTimeString(t.locale, { hour: "numeric", minute: "2-digit" });
const dateTime = (iso) => `${new Date(iso).toLocaleDateString(t.locale, t.dateFormat)} ${clock(iso)}`;
function agoMinutes(minutes) {
  const format = new Intl.RelativeTimeFormat(t.locale);
  if (minutes < 60) return format.format(-minutes, "minute");
  if (minutes < 1440) return format.format(-Math.floor(minutes / 60), "hour");
  return format.format(-Math.floor(minutes / 1440), "day");
}
const ago = (iso) => agoMinutes(Math.max(0, Math.round((Date.now() - new Date(iso)) / 60_000)));
function birthdayText(m) {
  const [month, day] = m.birthday.split("/").map(Number);
  return new Date(2000, month - 1, day).toLocaleDateString(t.locale, t.birthdayFormat);
}
const songTitle = (m) => (lang === "en" && m.song.titleEn) || m.song.title;
const songLabel = (m) => {
  const kind = t.kinds[m.song.kind];
  return lang === "ja" ? `${songTitle(m)}（${kind}）` : `${songTitle(m)} (${kind})`;
};
// Relative on purpose: viewers span time zones, and this reads the same everywhere.
function untilText(iso) {
  const seconds = Math.floor((new Date(iso) - Date.now()) / 1000);
  if (seconds <= 0) return t.startingSoon;
  if (seconds < 3600) {
    const pad = (n) => String(n).padStart(2, "0");
    return t.liveIn(`${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`);
  }
  const hours = Math.round(seconds / 3600);
  return t.liveIn(hours < 24 ? t.hours(hours) : t.days(Math.round(hours / 24)));
}

function tickCountdowns() {
  for (const node of document.querySelectorAll("[data-start]")) node.textContent = untilText(node.dataset.start);
}

function length(s) {
  if (!s.endedAt) return null;
  const minutes = Math.round((new Date(s.endedAt) - new Date(s.startedAt)) / 60_000);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

// --- Collabs ------------------------------------------------------------------

function compileMatchers() {
  for (const m of members) {
    const words = m.match.map((w) => w.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|");
    m.pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${words})(?![\\p{L}\\p{N}])`, "iu");
  }
}

// Only names in the title count, so collabs that do not name the guest are missed.
const collabsIn = (s) => members.filter((m) => m.id !== s.member && m.pattern.test(s.title));

// --- Views --------------------------------------------------------------------

function homeView() {
  const on = members.filter((m) => isLive(m.id));
  const now = on.length
    ? el("div", { class: "now on" },
        el("span", {}, t.liveNow(on.length)),
        el("div", { class: "now-list" }, on.map((m) =>
          el("a", { href: `#m-${m.id}`, "aria-label": t.memberLive(m.name) }, avatar(m, { showLive: false })))))
    : el("div", { class: "now" }, t.nobodyLive);

  const panels = teams.map((team) => {
    const roster = members.filter((m) => m.team === team.id);
    const count = liveCount(team.id);
    return el("a", {
      class: `panel${count ? " has-live" : ""}`,
      href: `#t-${team.id}`,
      style: teamStyle(team.id),
      "aria-label": count ? t.teamLive(team.name, count) : team.name,
    },
      el("h2", {}, el("span", { class: "suit", "aria-hidden": "true" }, team.suit), " ", team.name),
      el("p", { class: "genre" }, team.genre[lang]),
      el("div", { class: "faces" }, roster.map((m) => avatar(m))));
  });
  return [now, el("div", { class: "panels" }, panels), drawBlock()];
}

function drawCard() {
  const rest = members.filter((m) => m.id !== drawnId);
  drawnId = rest[Math.floor(Math.random() * rest.length)].id;
  const block = $(".draw");
  block.replaceWith(drawBlock());
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    $(".drawn").animate([{ transform: "rotateY(90deg)" }, { transform: "none" }], { duration: 320, easing: "ease-out" });
  }
}

function drawBlock() {
  const m = byId.get(drawnId);
  const button = el("button", { type: "button", class: "draw-button" }, m ? t.drawAgain : t.draw);
  button.addEventListener("click", drawCard);
  if (!m) return el("section", { class: "draw" }, button);
  const team = teams.find((x) => x.id === m.team);
  return el("section", { class: "draw", "aria-live": "polite" },
    el("article", { class: "drawn", style: teamStyle(m.team) },
      el("span", { class: "pip", "aria-hidden": "true" }, team.suit),
      avatar(m),
      el("div", { class: "drawn-text" },
        el("strong", {}, m.name, el("span", { class: "mark" }, m.mark)),
        el("span", {}, songLabel(m))),
      el("div", { class: "drawn-actions" },
        external(`https://www.youtube.com/watch?v=${m.song.id}`, { class: "listen" }, t.listen),
        el("a", { href: `#m-${m.id}` }, t.viewMember))),
    button);
}

const latestOf = (id) => streams.find((s) => s.member === id);

function teamView(team) {
  const liveFirst = [...members.filter((m) => m.team === team.id)]
    .sort((a, b) => isLive(b.id) - isLive(a.id));
  return [
    el("div", { class: "team-title" }, el("h1", {}, team.name), el("p", {}, team.genre[lang])),
    el("div", { class: "tiles" }, liveFirst.map(tile)),
  ];
}

function tile(m) {
  const current = live.find((s) => s.member === m.id);
  const last = latestOf(m.id);
  const line = current ? current.title : last ? `${ago(last.startedAt)}: ${last.title}` : t.noStreams;
  return el("a", { class: `tile${current ? " live" : ""}`, href: `#m-${m.id}`, style: teamStyle(m.team) },
    avatar(m),
    el("div", { class: "text" },
      el("strong", {}, nameLine(m), m.captain ? el("small", {}, "CAPTAIN") : null),
      el("span", { class: "latest" }, line)));
}

function floatHeart(color, origin) {
  if (document.querySelectorAll(".heart").length >= MAX_HEARTS) return;
  const box = origin.getBoundingClientRect();
  // U+FE0E forces the text glyph; an emoji heart would ignore the color.
  const heart = el("span", { class: "heart", "aria-hidden": "true" }, "♥︎");
  heart.style.color = color;
  heart.style.left = `${box.left + box.width / 2}px`;
  heart.style.top = `${box.top + box.height / 3}px`;
  document.body.append(heart);

  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const drift = (Math.random() - 0.5) * 90;
  const rise = 180 + Math.random() * 120;
  const size = 0.9 + Math.random() * 0.8;
  const frames = still
    ? [{ opacity: 1 }, { opacity: 0 }]
    : [
        { transform: "translate(-50%, 0) scale(.5)", opacity: 1 },
        { transform: `translate(calc(-50% + ${-drift / 2}px), ${-rise / 2}px) scale(${size})`, opacity: 1, offset: 0.5 },
        { transform: `translate(calc(-50% + ${drift}px), ${-rise}px) scale(${size})`, opacity: 0 },
      ];
  const duration = still ? 500 : 1400 + Math.random() * 500;
  heart.animate(frames, { duration, easing: "ease-out" });
  setTimeout(() => heart.remove(), duration); // a timer also fires when animation frames are paused
}

function cheerButton(m) {
  const button = el("button", { type: "button", class: "cheer", "aria-label": t.sendHeart(m.name) }, avatar(m));
  button.addEventListener("click", () => floatHeart(m.heart, button));
  return button;
}

const nameLine = (m) => [
  m.name,
  el("span", { class: "mark" }, m.mark),
  el("span", { class: "birthday", "aria-label": t.birthday(birthdayText(m)) }, `🎂${birthdayText(m)}`),
];

function memberView(m) {
  const mates = members.filter((x) => x.team === m.team).map((x) =>
    el("a", {
      href: `#m-${x.id}`,
      "aria-label": x.name,
      ...(x.id === m.id ? { "aria-current": "page" } : {}),
    }, avatar(x)));

  const xLink = external(`https://x.com/${m.x}`, { class: "x", "aria-label": t.xOf(m.name) });
  xLink.innerHTML = X_LOGO;

  const actions = el("div", { class: "actions" },
    xLink,
    external(`https://www.youtube.com/watch?v=${m.song.id}`, { class: "song", "aria-label": t.listenTo(songLabel(m)) },
      el("span", {}, `♪ ${songLabel(m)}`)));

  return [
    el("div", { class: "mates" }, mates),
    el("div", { class: "profile" },
      cheerButton(m),
      el("div", {}, el("h1", {}, nameLine(m)), el("p", {}, m.captain ? "CAPTAIN" : ""))),
    actions,
    m.chzzk ? lane(m, "chzzk") : null,
    m.youtube ? lane(m, "youtube") : null,
    m.twitch ? lane(m, "twitch") : null,
  ];
}

function lane(m, platform) {
  const { label, channel } = {
    youtube: { label: "YouTube", channel: `https://www.youtube.com/channel/${m.youtube}` },
    twitch: { label: "Twitch", channel: `https://www.twitch.tv/${m.twitch}` },
    chzzk: { label: "CHZZK", channel: `https://chzzk.naver.com/${m.chzzk}` },
  }[platform];
  const current = live.filter((s) => s.member === m.id && s.platform === platform);
  const liveIds = new Set(current.map((s) => s.id));
  const past = streams.filter((s) => s.member === m.id && s.platform === platform && !liveIds.has(s.id));
  const soon = platform === "youtube"
    ? upcoming
        .filter((s) => s.member === m.id && new Date(s.startedAt) > Date.now() - 3_600_000)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    : [];
  const total = current.length + past.length;

  return el("section", { class: `lane${current.length ? " live" : ""}`, "aria-label": t.streamsOn(label) },
    el("div", { class: "lane-head" },
      el("h2", {}, label),
      current.length ? pill() : null,
      total ? el("span", { class: "count" }, t.count(total)) : null,
      external(channel, {}, t.channel)),
    soon.length ? external(soon[0].url, { class: "countdown", "data-start": soon[0].startedAt }, untilText(soon[0].startedAt)) : null,
    total || soon.length
      ? el("div", { class: "shots", tabindex: "0", "data-lane": platform },
          soon.length ? el("div", { class: "minis" }, soon.map(mini)) : null, current.map((s) => shot(s, true)), past.map((s) => shot(s, false)), endMark())
      : el("p", { class: "empty" }, t.noStreams));
}

function mini(s, index) {
  const label = t.upcomingAt(dateTime(s.startedAt), s.title);
  const link = external(s.url, { class: `mini${index === 0 ? " next" : ""}`, "aria-label": label, title: label });
  if (s.thumb) link.append(el("img", { src: s.thumb, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }));
  return link;
}

function shot(s, onAir) {
  const thumb = el("div", { class: "thumb" });
  if (s.thumb) {
    const img = el("img", { src: s.thumb, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
    img.onerror = () => img.remove(); // Twitch VODs lose their thumbnail while processing
    thumb.append(img);
  }
  if (onAir) thumb.append(pill());
  else if (length(s)) thumb.append(el("span", { class: "length" }, length(s)));

  const guests = collabsIn(s);
  const link = external(s.url, { class: `shot${onAir ? " live" : ""}${watched.has(s.id) ? " watched" : ""}` },
    thumb,
    el("div", { class: "info" },
      el("span", { class: "title" }, s.title),
      el("time", { datetime: s.startedAt }, onAir ? t.liveSince(clock(s.startedAt)) : dateTime(s.startedAt)),
      guests.length
        ? el("div", { class: "with" }, "with", guests.slice(0, 5).map((g) => avatar(g, { showLive: false })), guests[0].name)
        : null));
  const remember = () => markWatched(s.id, link);
  link.addEventListener("click", remember);
  link.addEventListener("auxclick", remember);
  return link;
}

const endMark = () => el("div", { class: "shot end" }, "🃏", el("span", {}, t.reveal), el("span", {}, dateTime(config.announcedAt)));

function renderTabs(activeTeam) {
  const nav = $("#tabs");
  nav.hidden = !activeTeam;
  if (!activeTeam) return;
  nav.replaceChildren(...teams.map((team) => {
    const count = liveCount(team.id);
    return el("a", {
      class: `tab${count ? " has-live" : ""}`,
      href: `#t-${team.id}`,
      style: teamStyle(team.id),
      "aria-label": count ? t.teamLive(team.name, count) : team.name,
      ...(team.id === activeTeam ? { "aria-current": "page" } : {}),
    },
      el("span", { class: "suit", "aria-hidden": "true" }, team.suit),
      SHORT_TEAM[team.id],
      count ? el("span", { class: "count" }, `LIVE ${count}`) : null);
  }));
}

function route() {
  const hash = location.hash.slice(1);
  const kind = hash[0];
  const id = hash.slice(2);
  if (kind === "t") {
    const team = teams.find((x) => x.id === id);
    if (team) return { teamId: team.id, view: () => teamView(team) };
  }
  if (kind === "m" && byId.has(id)) {
    const m = byId.get(id);
    return { teamId: m.team, view: () => memberView(m) };
  }
  return { teamId: null, view: homeView };
}

function render() {
  const { teamId, view } = route();
  renderTabs(teamId);
  $("#app").replaceChildren(...view().flat().filter(Boolean));
}

// Polling must not throw the reader back to the newest thumbnail.
function renderKeepingPosition() {
  const offsets = new Map([...document.querySelectorAll("[data-lane]")].map((n) => [n.dataset.lane, n.scrollLeft]));
  const y = window.scrollY;
  render();
  for (const node of document.querySelectorAll("[data-lane]")) node.scrollLeft = offsets.get(node.dataset.lane) ?? 0;
  window.scrollTo(0, y);
}

function navigate() {
  render();
  window.scrollTo(0, 0);
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    $("#app").animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], 180);
  }
}

function renderChecked() {
  const node = $("#checked");
  if (!status) return;
  const age = Date.now() - new Date(status.checkedAt);
  const parts = [t.checked(agoMinutes(Math.max(0, Math.round(age / 60_000))))];
  if (age > STALE_MS) parts.push(t.stale);
  const missing = [!status.youtube && "YouTube", !status.twitch && "Twitch"].filter(Boolean);
  if (missing.length) parts.push(t.missing(missing));
  node.textContent = parts.join(" / ");
}

function applyStaticText() {
  document.documentElement.lang = lang;
  document.title = t.title;
  $('meta[name="description"]').content = t.description;
  $("#ribbon").textContent = t.unofficial;
  $("#tabs").setAttribute("aria-label", t.teams);
  const [before, link, after] = t.disclaimer;
  $("#disclaimer").replaceChildren(before, el("a", { href: "https://thewildcardclub.com/", rel: "noopener" }, link), after);
  $("#privacy").textContent = t.privacy;
  for (const button of document.querySelectorAll("[data-lang]")) {
    button.setAttribute("aria-pressed", String(button.dataset.lang === lang));
  }
}

function setLang(next) {
  if (next === lang) return;
  lang = next;
  t = STRINGS[lang];
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // the choice still applies until the page is reloaded
  }
  applyStaticText();
  renderChecked();
  if (members) renderKeepingPosition();
}

async function refresh() {
  const [liveData, streamData, avatarData, statusData] = await Promise.all([
    load("data/live.json"),
    load("data/streams.json"),
    load("data/avatars.json"),
    load("data/status.json"),
  ]);
  status = statusData;
  renderChecked();
  const next = JSON.stringify([liveData, streamData?.streams, avatarData?.urls]);
  if (next === snapshot) return;
  const first = !snapshot;
  snapshot = next;
  const all = [...(liveData?.youtube ?? []), ...(liveData?.twitch ?? []), ...(liveData?.chzzk ?? [])].filter((s) => byId.has(s.member));
  live = all.filter((s) => s.state === "live");
  upcoming = all.filter((s) => s.state === "upcoming");
  streams = (streamData?.streams ?? []).filter((s) => byId.has(s.member));
  avatars = avatarData?.urls ?? {};
  if (first) render();
  else renderKeepingPosition();
}

async function main() {
  applyStaticText();
  for (const button of document.querySelectorAll("[data-lang]")) {
    button.addEventListener("click", () => setLang(button.dataset.lang));
  }
  config = await load("data/members.json");
  if (!config) {
    $("#app").replaceChildren(el("p", { class: "empty" }, t.loadFailed));
    return;
  }
  ({ members, teams } = config);
  byId = new Map(members.map((m) => [m.id, m]));
  compileMatchers();
  window.addEventListener("hashchange", navigate);
  await refresh();
  setInterval(() => {
    if (!document.hidden) refresh();
  }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  setInterval(tickCountdowns, 1000);
}

main();
