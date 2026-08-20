export const CSS = `
  * { box-sizing: border-box; }
  button, input, textarea, select { font: inherit; }
  button { color: inherit; }
  .rv-root {
    --rv-ink: var(--text);
    --rv-muted: var(--muted);
    --rv-line: color-mix(in srgb, var(--border) 86%, transparent);
    min-height: 100%; color: var(--rv-ink); background:
      radial-gradient(circle at 18% -10%, color-mix(in srgb, var(--accent) 13%, transparent), transparent 31rem),
      var(--bg); font-family: var(--font); padding: 22px;
  }
  .rv-shell { width: min(1180px, 100%); margin: 0 auto; }
  .rv-header { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:20px; }
  .rv-brand { display:flex; align-items:center; gap:12px; min-width:0; }
  .rv-mark { width:42px; height:42px; border-radius:14px; display:grid; place-items:center; color:white;
    background:linear-gradient(145deg, color-mix(in srgb, var(--accent) 84%, #3f7f73), var(--accent));
    box-shadow:0 10px 24px color-mix(in srgb, var(--accent) 22%, transparent); }
  .rv-title { font-size:22px; font-weight:760; letter-spacing:-.035em; line-height:1.05; }
  .rv-subtitle { color:var(--rv-muted); font-size:13px; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .rv-actions { display:flex; align-items:center; gap:9px; }
  .rv-pill, .rv-status { min-height:32px; padding:0 11px; border:1px solid var(--rv-line); border-radius:999px;
    display:inline-flex; align-items:center; gap:7px; font-size:12px; color:var(--rv-muted); background:color-mix(in srgb, var(--surface) 88%, transparent); }
  .rv-dot { width:7px; height:7px; border-radius:50%; background:#87918f; }
  .rv-dot.good { background:#31a77d; box-shadow:0 0 0 4px color-mix(in srgb, #31a77d 14%, transparent); }
  .rv-dot.active { background:var(--accent); box-shadow:0 0 0 4px color-mix(in srgb, var(--accent) 14%, transparent); }
  .rv-dot.attention { background:#c58a36; box-shadow:0 0 0 4px color-mix(in srgb, #c58a36 14%, transparent); }
  .rv-icon-btn, .rv-btn { border:1px solid var(--rv-line); background:var(--surface); min-height:44px; border-radius:13px;
    display:inline-flex; align-items:center; justify-content:center; gap:8px; cursor:pointer; transition:transform .16s ease, border-color .16s ease, background .16s ease; }
  .rv-icon-btn { width:44px; padding:0; }
  .rv-btn { padding:0 15px; font-weight:680; font-size:13px; }
  .rv-btn.primary { background:var(--accent); color:white; border-color:transparent; }
  .rv-btn:hover, .rv-icon-btn:hover { transform:translateY(-1px); border-color:color-mix(in srgb, var(--accent) 42%, var(--border)); }
  .rv-btn:focus-visible, .rv-icon-btn:focus-visible, .rv-tab:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, .rv-switch:focus-visible { outline:3px solid color-mix(in srgb, var(--accent) 28%, transparent); outline-offset:2px; }
  .rv-btn:disabled, .rv-icon-btn:disabled { opacity:.5; cursor:default; transform:none; }
  .rv-tabs { display:flex; gap:6px; padding:5px; background:color-mix(in srgb, var(--surface) 88%, transparent); border:1px solid var(--rv-line); border-radius:16px; margin-bottom:18px; overflow:auto; }
  .rv-tab { border:0; min-height:42px; padding:0 15px; border-radius:11px; color:var(--rv-muted); background:transparent; cursor:pointer; font-size:13px; font-weight:670; white-space:nowrap; }
  .rv-tab.active { color:var(--rv-ink); background:var(--surface-2); box-shadow:0 1px 4px rgba(0,0,0,.08); }
  .rv-grid { display:grid; grid-template-columns:minmax(0,1.55fr) minmax(260px,.7fr); gap:16px; }
  .rv-inbox-layout { width:min(900px,100%); margin:0 auto; display:grid; gap:12px; align-content:start; }
  .rv-stack { display:grid; gap:12px; align-content:start; }
  .rv-card { background:color-mix(in srgb, var(--surface) 94%, transparent); border:1px solid var(--rv-line); border-radius:18px; padding:17px; box-shadow:0 12px 36px rgba(0,0,0,.045); }
  .rv-hero { padding:20px; background:linear-gradient(135deg, color-mix(in srgb, var(--surface) 96%, transparent), color-mix(in srgb, var(--accent) 7%, var(--surface))); }
  .rv-eyebrow { text-transform:uppercase; letter-spacing:.105em; font-size:10px; font-weight:820; color:var(--accent); }
  .rv-hero h2 { margin:7px 0 6px; font-size:25px; line-height:1.12; letter-spacing:-.035em; }
  .rv-hero p, .rv-copy { margin:0; color:var(--rv-muted); line-height:1.55; font-size:13px; }
  .rv-metrics { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:18px; }
  .rv-metric { padding:12px; border-radius:14px; border:1px solid var(--rv-line); background:color-mix(in srgb, var(--bg) 55%, transparent); }
  .rv-metric strong { display:block; font-size:19px; letter-spacing:-.035em; }
  .rv-metric-state.good { color:#31a77d; }
  .rv-metric-state.active { color:var(--accent); }
  .rv-metric-state.attention { color:#c58a36; }
  .rv-metric span { color:var(--rv-muted); font-size:11px; }
  .rv-section-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:11px; }
  .rv-section-head h3 { margin:0; font-size:14px; letter-spacing:-.015em; }
  .rv-pr { display:grid; grid-template-columns:auto minmax(0,1fr); gap:12px; align-items:start; }
  .rv-avatar { width:36px; height:36px; border-radius:11px; overflow:hidden; background:linear-gradient(135deg,var(--surface-2),var(--accent-soft)); }
  .rv-avatar img { width:100%; height:100%; object-fit:cover; display:block; }
  .rv-pr-main { min-width:0; }
  .rv-pr-heading { min-width:0; display:flex; align-items:flex-start; flex-wrap:wrap; gap:6px 8px; }
  .rv-review-detail { margin-top:12px; border-top:1px solid var(--border); padding-top:10px; }
  .rv-review-detail summary { width:max-content; cursor:pointer; color:var(--accent); font-weight:700; }
  .rv-review-detail[open] summary { margin-bottom:10px; }
  .rv-card-sent { flex:0 0 auto; display:inline-flex; align-items:center; gap:4px; min-height:23px; padding:0 7px; border-radius:999px; color:#84d7ac; background:color-mix(in srgb,#31a77d 10%,transparent); font-size:10px; font-weight:780; }
  .rv-retry { flex:0 0 auto; width:44px; height:44px; margin:-10px -8px -10px -6px; padding:0; display:inline-grid; place-items:center; border:0; border-radius:50%; color:var(--accent); background:transparent; cursor:pointer; }
  .rv-retry:hover { background:color-mix(in srgb, var(--accent) 11%, transparent); }
  .rv-retry:focus-visible { outline:3px solid color-mix(in srgb, var(--accent) 28%, transparent); outline-offset:-5px; }
  .rv-retry:disabled, .rv-retry[aria-disabled="true"] { opacity:.62; cursor:default; }
  .rv-retry.error { color:#e88378; }
  .rv-spin { animation:rv-spin .9s linear infinite; }
  @keyframes rv-spin { to { transform:rotate(360deg); } }
  .rv-comment-preview { margin-top:10px; }
  .rv-comment-preview pre { margin:0; padding:12px; white-space:pre-wrap; overflow-wrap:anywhere; border-radius:12px; background:var(--bg); color:var(--muted); font:inherit; font-size:12px; line-height:1.55; }
  .rv-send-wrap { margin-top:12px; display:grid; justify-items:start; gap:8px; }
  .rv-send-error { margin:0; font-size:12px; line-height:1.45; }
  .rv-send-confirm { margin-top:12px; padding:12px; display:grid; gap:11px; border:1px solid color-mix(in srgb, var(--accent) 34%, var(--border)); border-radius:14px; background:color-mix(in srgb, var(--accent) 7%, var(--surface-2)); }
  .rv-send-confirm strong, .rv-send-confirm small { display:block; }
  .rv-send-confirm strong { font-size:13px; line-height:1.4; }
  .rv-send-confirm small { margin-top:4px; color:var(--rv-muted); line-height:1.45; }
  .rv-send-actions { display:flex; flex-wrap:wrap; gap:8px; }
  .rv-send-result { margin-top:12px; min-height:44px; padding:10px 12px; display:flex; align-items:center; gap:8px; border:1px solid var(--rv-line); border-radius:13px; font-size:12px; line-height:1.4; }
  .rv-send-result svg { flex:0 0 auto; }
  .rv-send-result.warning { color:#e8bd79; background:rgba(245,168,62,.09); }
  .rv-pr-title { min-width:0; font-size:14px; line-height:1.35; font-weight:720; color:inherit; text-decoration:none; }
  .rv-pr-title:hover { color:var(--accent); }
  .rv-capacity { display:flex; align-items:flex-start; gap:7px; margin:12px 0 0; padding:10px 11px; border-radius:12px; background:rgba(245,168,62,.09); color:#e8bd79; font-size:12px; line-height:1.45; }
  .rv-capacity svg { flex:0 0 auto; margin-top:1px; }
  .rv-meta { display:flex; flex-wrap:wrap; gap:7px 11px; margin-top:7px; color:var(--rv-muted); font-size:11px; }
  .rv-diff { display:inline-flex; gap:6px; font-variant-numeric:tabular-nums; }
  .rv-additions { color:#84d7ac; }
  .rv-deletions { color:#e88378; }
  .rv-risk { flex:0 0 auto; white-space:nowrap; margin-top:1px; text-transform:capitalize; font-size:10px; font-weight:800; padding:4px 7px; border-radius:999px; border:1px solid var(--rv-line); }
  .rv-risk.high { color:#c75c52; background:color-mix(in srgb, #c75c52 10%, transparent); }
  .rv-risk.medium { color:#a77a24; background:color-mix(in srgb, #d39b2d 10%, transparent); }
  .rv-risk.focused { color:#2f8d70; background:color-mix(in srgb, #31a77d 9%, transparent); }
  .rv-inbox-groups { display:grid; gap:9px; }
  .rv-inbox-group { overflow:hidden; border:1px solid var(--rv-line); border-radius:17px; background:color-mix(in srgb,var(--surface) 91%,transparent); }
  .rv-inbox-group > summary { min-height:54px; padding:0 15px; display:flex; align-items:center; gap:10px; list-style:none; cursor:pointer; user-select:none; }
  .rv-inbox-group > summary::-webkit-details-marker { display:none; }
  .rv-inbox-group > summary:hover { background:color-mix(in srgb,var(--accent) 5%,transparent); }
  .rv-inbox-group > summary:focus-visible { outline:3px solid color-mix(in srgb,var(--accent) 28%,transparent); outline-offset:-3px; }
  .rv-group-label { min-width:0; flex:1; display:flex; align-items:center; gap:9px; font-size:13px; font-weight:740; }
  .rv-group-dot { width:8px; height:8px; flex:0 0 auto; border-radius:50%; background:var(--rv-muted); }
  .rv-inbox-group.findings .rv-group-dot { background:#d7a74f; }
  .rv-inbox-group.clear .rv-group-dot { background:#31a77d; }
  .rv-inbox-group.active .rv-group-dot { background:var(--accent); }
  .rv-inbox-group.attention .rv-group-dot { background:#c58a36; }
  .rv-group-count { min-width:26px; padding:3px 7px; border-radius:999px; text-align:center; color:var(--rv-muted); background:var(--surface-2); font-size:11px; font-variant-numeric:tabular-nums; }
  .rv-group-chevron { flex:0 0 auto; color:var(--rv-muted); transition:transform .16s ease; }
  .rv-inbox-group[open] .rv-group-chevron { transform:rotate(180deg); }
  .rv-group-list { padding:0 9px 9px; display:grid; gap:8px; }
  .rv-group-list .rv-pr { border-radius:13px; box-shadow:none; background:color-mix(in srgb,var(--surface) 98%,transparent); }
  .rv-empty { padding:38px 20px; text-align:center; }
  .rv-empty-icon { width:48px; height:48px; border-radius:16px; display:grid; place-items:center; margin:0 auto 12px; background:color-mix(in srgb, var(--accent) 12%, var(--surface-2)); color:var(--accent); }
  .rv-empty h3 { margin:0 0 6px; font-size:16px; }
  .rv-empty p { margin:0 auto 16px; color:var(--rv-muted); font-size:13px; max-width:420px; line-height:1.5; }
  .rv-alert { display:flex; gap:10px; align-items:flex-start; border-color:color-mix(in srgb, #c58b27 35%, var(--border)); background:color-mix(in srgb, #c58b27 8%, var(--surface)); }
  .rv-alert strong { display:block; font-size:13px; margin-bottom:3px; }
  .rv-search { position:relative; }
  .rv-search svg { position:absolute; left:13px; top:50%; transform:translateY(-50%); color:var(--rv-muted); pointer-events:none; }
  .rv-input, .rv-textarea { width:100%; border:1px solid var(--rv-line); background:var(--bg); color:var(--rv-ink); border-radius:13px; }
  .rv-input { height:44px; padding:0 13px; }
  .rv-search .rv-input { padding-left:39px; }
  .rv-textarea { min-height:210px; resize:vertical; padding:13px; line-height:1.55; font-size:13px; }
  .rv-repo-list { display:grid; gap:7px; max-height:520px; overflow:auto; padding-right:3px; }
  .rv-repo { min-height:58px; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 12px; border:1px solid var(--rv-line); border-radius:14px; }
  .rv-repo-main { min-width:0; }
  .rv-repo-name { font-weight:710; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .rv-repo-note { color:var(--rv-muted); font-size:11px; margin-top:3px; }
  .rv-repo-divider { position:relative; height:25px; display:flex; align-items:center; justify-content:center; color:var(--rv-muted); font-size:10px; text-transform:uppercase; letter-spacing:.08em; }
  .rv-repo-divider::before { content:''; position:absolute; left:0; right:0; top:50%; border-top:1px solid var(--rv-line); }
  .rv-repo-divider span { position:relative; padding:0 9px; background:var(--surface); }
  .rv-switch { position:relative; width:46px; height:28px; border:1px solid color-mix(in srgb, var(--rv-muted) 42%, var(--rv-line)); border-radius:999px; background:color-mix(in srgb, var(--rv-muted) 24%, var(--surface-2)); box-shadow:inset 0 1px 2px rgba(0,0,0,.22); cursor:pointer; flex:0 0 auto; }
  .rv-switch::after { content:''; position:absolute; width:20px; height:20px; left:3px; top:3px; border-radius:50%; background:#f3f6f5; box-shadow:0 1px 4px rgba(0,0,0,.34); transition:transform .18s ease, background .18s ease; }
  .rv-switch.on { border-color:color-mix(in srgb, var(--accent) 72%, white 8%); background:color-mix(in srgb, var(--accent) 58%, var(--surface-2)); }
  .rv-switch.on::after { transform:translateX(18px); background:white; }
  .rv-switch:disabled { opacity:.58; cursor:default; }
  .rv-setting { display:flex; align-items:center; justify-content:space-between; gap:18px; padding:13px 0; border-bottom:1px solid var(--rv-line); }
  .rv-automation-layout { width:min(900px,100%); margin:0 auto; }
  .rv-automation-statusbar { margin:-2px 0 22px; padding:2px 0 18px; border-bottom:1px solid var(--rv-line); display:flex; align-items:flex-start; justify-content:space-between; gap:18px; }
  .rv-automation-status-copy { min-width:0; }
  .rv-automation-status-title { display:flex; align-items:center; gap:7px; font-size:15px; }
  .rv-automation-status-title strong { font-size:16px; letter-spacing:-.02em; }
  .rv-automation-status-copy p { margin:6px 0 0 14px; color:var(--rv-muted); font-size:11px; line-height:1.5; }
  .rv-btn.rv-compact { padding:0 12px; }
  .rv-setting-group + .rv-setting-group { margin-top:25px; padding-top:23px; border-top:1px solid var(--rv-line); }
  .rv-setting-group-head { margin-bottom:3px; }
  .rv-setting-group-head h2 { margin:0; font-size:18px; letter-spacing:-.025em; }
  .rv-setting-group-head p { margin:4px 0 0; color:var(--rv-muted); font-size:11px; line-height:1.5; }
  .rv-agent-group-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
  .rv-agent-group-head > div { min-width:0; }
  .rv-agent-group-head .rv-status { flex:0 0 auto; }
  .rv-agent-list { margin-top:10px; border:1px solid var(--rv-line); border-radius:15px; overflow:hidden; }
  .rv-agent-setting { display:grid; grid-template-columns:minmax(190px,.8fr) minmax(280px,1.2fr); align-items:center; gap:16px; padding:13px; background:color-mix(in srgb,var(--bg) 32%,transparent); }
  .rv-agent-setting + .rv-agent-setting { border-top:1px solid var(--rv-line); }
  .rv-agent-copy { min-width:0; }
  .rv-agent-title { display:flex; flex-wrap:wrap; align-items:center; gap:6px; }
  .rv-agent-title strong { font-size:13px; }
  .rv-agent-title span { padding:3px 6px; border-radius:999px; color:var(--accent); background:color-mix(in srgb,var(--accent) 10%,transparent); font-size:9px; font-weight:780; text-transform:uppercase; letter-spacing:.04em; }
  .rv-agent-copy small { display:block; margin-top:5px; color:var(--rv-muted); font-size:11px; line-height:1.4; }
  .rv-agent-controls { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr); gap:8px; }
  .rv-agent-controls label { min-width:0; }
  .rv-agent-controls label > span { display:block; margin:0 0 5px 2px; color:var(--rv-muted); font-size:9px; font-weight:760; text-transform:uppercase; letter-spacing:.06em; }
  .rv-agent-controls .rv-input { min-width:0; font-size:12px; }
  .rv-agent-note { margin:9px 1px 0; color:var(--rv-muted); font-size:10px; line-height:1.5; }
  .rv-setting > div:first-child { min-width:0; }
  .rv-setting:last-child { border-bottom:0; }
  .rv-setting strong { display:block; font-size:13px; }
  .rv-setting small { display:block; color:var(--rv-muted); margin-top:4px; line-height:1.4; }
  .rv-inline-state { margin-top:10px; padding:9px 11px; border-radius:11px; color:var(--rv-muted); background:color-mix(in srgb,var(--accent) 8%,var(--surface-2)); font-size:11px; }
  .rv-inline-state.error { color:#e88378; }
  .rv-number { width:82px; text-align:center; }
  .rv-guide-preview { white-space:pre-wrap; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11px; line-height:1.55; max-height:480px; overflow:auto; background:var(--bg); }
  .rv-save { color:#2f8d70; font-size:11px; min-height:18px; }
  .rv-error { color:#c75c52; }
  .rv-inline { display:flex; gap:8px; align-items:center; }
  @media (max-width: 760px) {
    .rv-root { padding:14px; }
    .rv-header { align-items:flex-start; }
    .rv-pill { display:none; }
    .rv-grid { grid-template-columns:1fr; }
    .rv-metrics { grid-template-columns:repeat(3,1fr); }
    .rv-card { border-radius:16px; }
    .rv-setting { align-items:flex-start; }
    .rv-agent-setting { grid-template-columns:1fr; }
  }
  @media (max-width: 430px) {
    .rv-root { padding:12px; }
    .rv-subtitle { max-width:210px; }
    .rv-title { font-size:20px; }
    .rv-tabs { margin-left:-3px; margin-right:-3px; }
    .rv-tab { padding:0 12px; }
    .rv-metric { padding:10px 8px; }
    .rv-metric strong { font-size:17px; }
    .rv-metric-state { font-size:14px !important; line-height:1.15; }
    .rv-agent-group-head { display:grid; }
    .rv-automation-statusbar { gap:10px; }
    .rv-automation-status-copy p { margin-left:0; }
    .rv-agent-controls { grid-template-columns:1fr; }
    .rv-send-actions { display:grid; grid-template-columns:1fr; }
    .rv-send-actions .rv-btn { width:100%; }
    .rv-send-result { align-items:flex-start; flex-wrap:wrap; }
  }
  @media (prefers-reduced-motion: reduce) {
    .rv-btn, .rv-icon-btn, .rv-switch::after, .rv-group-chevron { transition:none; }
    .rv-spin { animation:none; }
  }
`
