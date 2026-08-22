/**
 * What the agent's browser actually costs.
 *
 * Three questions, measured rather than argued:
 *
 *   1. Does a permanently attached debugger with `Accessibility` enabled cost
 *      anything? The host attaches on the first snapshot and only detaches when
 *      the tab closes, so a tab the agent has ever read stays in that state.
 *      Chromium does not build a full accessibility tree unless something asks;
 *      once asked, it maintains one across every DOM mutation.
 *   2. How large is a snapshot? Tokens are the running cost of using the thing.
 *   3. How much of a snapshot repeats the one before it? That is the size of the
 *      prize for sending diffs instead of whole trees.
 *
 * Real Chromium, real <webview>, real BrowserHost — the same code path the
 * agent takes. Numbers from a synthetic harness would not be worth having.
 */
const { app, BrowserWindow, webContents, ipcMain } = require('electron');
const path = require('node:path');

const HOST_MODULE = process.argv[2];
const { BrowserHost, BROWSER_PARTITION } = require(HOST_MODULE);

/** Pages chosen to span the range: static, content-heavy, constantly moving. */
const PAGES = process.env.BENCH_PAGES
  ? process.env.BENCH_PAGES.split(',')
  : [
      'https://example.com',
      'https://en.wikipedia.org/wiki/Cat',
      'https://www.youtube.com/results?search_query=koty',
    ];

/** Long enough to average out a sampling window; short enough to stay bearable. */
const SAMPLE_MS = Number(process.env.BENCH_SAMPLE_MS ?? 6000);
const SETTLE_MS = Number(process.env.BENCH_SETTLE_MS ?? 4000);
/** Short, so the release can be watched happening rather than waited out. */
const IDLE_MS = Number(process.env.BENCH_IDLE_MS ?? 3000);
/**
 * A heavy page the agent reads over and over.
 *
 * It tries to start playback, and on a bare Electron it will not: YouTube's
 * player stays paused however it is asked, so what this phase actually measures
 * is repeated reads of a large, mostly-still page. The moving case has to be
 * measured in the real app, where playback works — see the note the phase prints
 * when it could not start the video, and do not read the result as if it had.
 */
const LIVE_URL = process.env.BENCH_LIVE_URL ?? 'https://www.youtube.com/watch?v=75TUXS9nGAw';
/** How many times the agent looks at that page, and how far apart. */
const LIVE_READS = Number(process.env.BENCH_LIVE_READS ?? 6);
const LIVE_GAP_MS = Number(process.env.BENCH_LIVE_GAP_MS ?? 2000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => process.stdout.write(a.join(' ') + '\n');

/**
 * Average CPU share and resident memory of one process over a window.
 *
 * `getAppMetrics` reports CPU as a percentage of one core since the last read,
 * so it has to be sampled repeatedly rather than read once.
 */
async function sample(pid, ms) {
  const cpu = [];
  let memKb = 0;
  const started = Date.now();
  while (Date.now() - started < ms) {
    await sleep(250);
    const entry = app.getAppMetrics().find((m) => m.pid === pid);
    if (!entry) continue;
    cpu.push(entry.cpu?.percentCPUUsage ?? 0);
    memKb = entry.memory?.workingSetSize ?? memKb;
  }
  // The first sample covers everything since process start, not the window.
  const usable = cpu.slice(1);
  const avg = usable.length ? usable.reduce((a, b) => a + b, 0) / usable.length : 0;
  return { cpuPct: avg, memMb: memKb / 1024 };
}

/** Share of lines a second snapshot repeats from the first. */
function repeatRatio(a, b) {
  const before = new Map();
  for (const line of a.split('\n')) before.set(line, (before.get(line) ?? 0) + 1);
  let repeated = 0;
  const after = b.split('\n');
  for (const line of after) {
    const n = before.get(line) ?? 0;
    if (n > 0) {
      repeated++;
      before.set(line, n - 1);
    }
  }
  return after.length ? repeated / after.length : 0;
}

const fmt = (n, d = 1) => n.toFixed(d);
/** Tokens are not characters; ~4 chars each is the usual working figure. */
const tokens = (text) => Math.round(text.length / 4);

app.commandLine.appendSwitch('disable-gpu');
// A playing video is the point of the last phase, and Chromium will not start
// one without a user gesture. The policy is orthogonal to what is being
// measured — the cost of reading a page that keeps changing.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(async () => {
  const host = new BrowserHost((id) => {
    const wc = webContents.fromId(id);
    return wc && !wc.isDestroyed() ? wc : null;
  }, IDLE_MS);

  const win = new BrowserWindow({
    show: false,
    width: 1360,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      webviewTag: true,
    },
  });
  win.webContents.on('will-attach-webview', (_e, webPreferences, params) => {
    params.nodeIntegration = false;
    params.partition = BROWSER_PARTITION;
    delete params.preload;
    Object.assign(webPreferences, { contextIsolation: true, sandbox: true, nodeIntegration: false });
  });

  const ready = new Promise((res) => ipcMain.once('wv-ready', (_e, id) => res(id)));
  await win.loadFile(path.join(__dirname, 'index.html'));
  const wcId = await ready;
  host.register(wcId);
  const guest = webContents.fromId(wcId);

  log(`\n# Koszt przeglądarki agenta`);
  log(`próbkowanie ${SAMPLE_MS}ms · osiadanie ${SETTLE_MS}ms\n`);

  const rows = [];
  for (const url of PAGES) {
    log(`── ${url}`);
    await host.goto(url);
    await sleep(SETTLE_MS);
    // Site isolation gives a cross-origin navigation a NEW renderer process, so
    // the pid has to be read after the page settles, not once at startup.
    const pid = guest.getOSProcessId();

    // 1. The page as the user has it: drawn, nothing attached.
    const idle = await sample(pid, SAMPLE_MS);
    log(`   sama strona          CPU ${fmt(idle.cpuPct)}%  RAM ${fmt(idle.memMb, 0)} MB`);

    // 2. One read, then a second straight after it. Back to back on purpose:
    //    the idle release below would otherwise expire between them and the
    //    second read would be a fresh one, measuring nothing.
    const t0 = Date.now();
    const snap = await host.snapshot();
    const snapMs = Date.now() - t0;
    if (!snap.ok) {
      log(`   snapshot nieudany: ${snap.error?.message}\n`);
      continue;
    }
    const text = snap.result.text;
    const again = await host.snapshot();
    const againTokens = again.ok ? tokens(again.result.text) : 0;
    const saved = tokens(text) > 0 ? 1 - againTokens / tokens(text) : 0;

    const watched = await sample(pid, SAMPLE_MS);
    log(
      `   + CDP i AX włączone  CPU ${fmt(watched.cpuPct)}%  RAM ${fmt(watched.memMb, 0)} MB` +
        `   (Δ ${fmt(watched.cpuPct - idle.cpuPct)} pkt CPU, ${fmt(watched.memMb - idle.memMb, 0)} MB)`,
    );

    // 3. And after ONE element appears near the top of the document — the
    //     smallest change a real page makes. uids are handed out by document
    //     order, so an insertion renumbers everything below it. If a diff is
    //     going to pay, the unchanged part has to still look unchanged; this is
    //     the number that says whether diffing formatted text can work at all.
    await guest
      .executeJavaScript(
        'document.body.insertAdjacentHTML("afterbegin", "<button>bench-marker</button>"); true',
      )
      .catch(() => {});
    await sleep(1500);
    const scrolled = await host.snapshot();
    const movedTokens = scrolled.ok ? tokens(scrolled.result.text) : 0;
    const repeatMoved = scrolled.ok ? repeatRatio(text, scrolled.result.text) : 0;

    log(
      `   snapshot             ${snapMs} ms  ${snap.result.nodes} węzłów  ` +
        `${(text.length / 1024).toFixed(1)} KB  ~${tokens(text)} tokenów`,
    );
    log(
      `   ponowny odczyt bez zmian   ~${againTokens} tokenów zamiast ~${tokens(text)}` +
        `   (oszczędność ${fmt(saved * 100, 0)}%)`,
    );
    log(
      `   po dodaniu 1 elementu      ~${movedTokens} tokenów zamiast ~${tokens(text)}` +
        `   (oszczędność ${fmt((1 - movedTokens / Math.max(1, tokens(text))) * 100, 0)}%)`,
    );

    // 4. And whether the tab is let go of once the agent stops working it.
    //    Reported as the fact, not as megabytes: the allocator decides when the
    //    OS sees them back, and a figure that swings with unrelated activity
    //    would be a number pretending to be a measurement.
    await sleep(IDLE_MS + 1500);
    const stillAttached = guest.debugger.isAttached();
    log(`   po ${IDLE_MS / 1000}s bezczynności     drzewo ${stillAttached ? 'NADAL trzymane' : 'oddane'}\n`);

    rows.push({
      url,
      idle,
      watched,
      snapMs,
      nodes: snap.result.nodes,
      tokens: tokens(text),
      saved,
      againTokens,
      repeatMoved,
      movedTokens,
      released: !stillAttached,
    });
  }

  // ---------------------------------------------------------------------
  // The case the other pages do not cover: the agent working a page that is
  // changing under it. Everything above settles and then holds still, which is
  // where "unchanged" wins; a playing video is where it cannot.
  log(`── ${LIVE_URL}  (powtarzane odczyty ciężkiej strony)`);
  await host.goto(LIVE_URL);
  await sleep(SETTLE_MS);
  const livePid = guest.getOSProcessId();
  const playing = await guest
    .executeJavaScript(
      'const v = document.querySelector("video");' +
        'if (v) { v.muted = true; const p = v.play(); if (p) p.catch(() => {}); }' +
        'new Promise((r) => setTimeout(() => r(!!(v && !v.paused)), 1200))',
    )
    .catch(() => false);
  log(
    `   odtwarzanie: ${playing ? 'tak' : 'NIE — Chromium bez interfejsu nie startuje odtwarzacza.'}` +
      `${playing ? '' : '\n   Ruchomą stronę trzeba zmierzyć w aplikacji; te liczby dotyczą strony w bezruchu.'}`,
  );

  // A. The page as the user has it: playing, nothing attached.
  const liveIdle = await sample(livePid, SAMPLE_MS);
  log(`   sam film             CPU ${fmt(liveIdle.cpuPct)}%  RAM ${fmt(liveIdle.memMb, 0)} MB`);

  // B. The same, while the agent reads it over and over — sampled DURING the
  //    reads rather than after, because the question is what working the page
  //    costs, not what the page costs once the agent has stopped.
  const reads = [];
  const busy = sample(livePid, LIVE_READS * LIVE_GAP_MS);
  for (let i = 0; i < LIVE_READS; i++) {
    const t = Date.now();
    const r = await host.snapshot();
    reads.push({
      ms: Date.now() - t,
      unchanged: r.ok && r.result.unchanged === true,
      text: r.ok ? r.result.text : '',
    });
    await sleep(LIVE_GAP_MS);
  }
  const liveBusy = await busy;

  const hits = reads.filter((r) => r.unchanged).length;
  const spent = reads.reduce((a, r) => a + tokens(r.text), 0);
  const wouldHaveSpent = tokens(reads[0].text) * reads.length;
  const overlaps = [];
  for (let i = 1; i < reads.length; i++) {
    if (!reads[i].unchanged && !reads[i - 1].unchanged) {
      overlaps.push(repeatRatio(reads[i - 1].text, reads[i].text));
    }
  }
  const avgOverlap = overlaps.length ? overlaps.reduce((a, b) => a + b, 0) / overlaps.length : 1;

  log(
    `   agent czyta co ${LIVE_GAP_MS / 1000}s     CPU ${fmt(liveBusy.cpuPct)}%  RAM ${fmt(liveBusy.memMb, 0)} MB` +
      `   (Δ ${fmt(liveBusy.cpuPct - liveIdle.cpuPct)} pkt CPU)`,
  );
  log(`   ${LIVE_READS} odczytów             ~${spent} tokenów łącznie (bez skrótu byłoby ~${wouldHaveSpent})`);
  log(`   trafień "bez zmian"        ${hits}/${LIVE_READS}`);
  log(`   wspólnych linii między kolejnymi odczytami  ${fmt(avgOverlap * 100, 0)}%  (sufit dla diffu)`);
  log(`   czas odczytu               ${Math.min(...reads.map((r) => r.ms))}–${Math.max(...reads.map((r) => r.ms))} ms\n`);

  log('# Podsumowanie\n');
  log('| strona | Δ CPU | koszt AX w RAM | tokeny/snapshot | ponowny odczyt | oddane po bezczynności | po zmianie |');
  log('|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const host_ = new URL(r.url).hostname.replace(/^www\./, '');
    log(
      `| ${host_} | ${fmt(r.watched.cpuPct - r.idle.cpuPct)} | ` +
        `+${fmt(r.watched.memMb - r.idle.memMb, 0)} MB | ~${r.tokens} | ` +
        `~${r.againTokens} (−${fmt(r.saved * 100, 0)}%) | ${r.released ? 'tak' : 'NIE'} | ` +
        `~${r.movedTokens} |`,
    );
  }
  log('');
  host.closeAll();
  app.exit(0);
});
