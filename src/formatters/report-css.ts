/** Inline stylesheet for the suite report: light/dark, phone width, Letter/A4 print. */
export const REPORT_CSS = `
:root{--bg:#fff;--fg:#1a1d23;--muted:#5b6472;--line:#e3e6eb;--card:#f6f7f9;--accent:#2f5bea;--hit:#fff1c2;--hitfg:#1a1d23;--good:#1a7f4b;--warn:#b26a00;--bad:#c62828;--track:#e8ebf0}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e8eaee;--muted:#9aa3b2;--line:#2a2e36;--card:#1c1f25;--accent:#7c9bff;--hit:#4a3d10;--hitfg:#fff;--good:#4cc38a;--warn:#f0a63a;--bad:#ff6b6b;--track:#2a2e36}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:880px;margin:0 auto;padding:20px 20px 40px}
header{border-bottom:1px solid var(--line);padding-bottom:14px}
.hd{display:flex;gap:24px;align-items:center;flex-wrap:wrap}
.eyebrow{margin:0;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.suite{margin:2px 0 10px;font-size:15px;font-weight:600;overflow-wrap:anywhere}
.explain,.check{font-size:14px;margin:4px 0}
.check a{color:var(--fg)}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:17px;margin:20px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:15px;margin:0 0 4px}
p{margin:4px 0}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}
code{overflow-wrap:anywhere}
.muted{color:var(--muted);font-size:13px}
.meta{color:var(--muted);font-size:13px;margin-top:8px}
.sub{font-weight:600;margin:12px 0 4px}
.score{display:flex;align-items:baseline;gap:2px;padding:10px 18px;border-radius:12px;background:var(--card);border:1px solid var(--line);border-left:4px solid var(--muted)}
.score .big{font-size:46px;font-weight:700;line-height:1}
.score .of{color:var(--muted);font-size:16px}
.score .grade{margin-left:12px;font-size:28px;font-weight:700}
.g-A,.g-B{border-left-color:var(--good)}.g-A .grade,.g-B .grade{color:var(--good)}
.g-C{border-left-color:var(--warn)}.g-C .grade{color:var(--warn)}
.g-D,.g-F{border-left-color:var(--bad)}.g-D .grade,.g-F .grade{color:var(--bad)}
.notscored{border-left-color:var(--bad)}.notscored .grade{margin-left:12px;font-size:16px;color:var(--fg)}
@media (min-width:720px){.dims{display:grid;grid-template-columns:1fr 1fr;column-gap:28px}}
.dim{margin:8px 0}.dimhead{display:flex;justify-content:space-between}
.bar{height:10px;background:var(--track);border-radius:5px;overflow:hidden;margin:4px 0}
.bar span{display:block;height:100%;background:var(--accent);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.finding{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--warn);border-radius:8px;padding:12px 14px;margin:12px 0;break-inside:avoid}
.finding.sev-error{border-left-color:var(--bad)}
.rank{display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;background:var(--fg);color:var(--bg);font-size:12px;margin-right:8px}
.tag{font-size:11px;font-weight:600;border:1px solid var(--line);border-radius:10px;padding:1px 8px;margin-left:6px;color:var(--fg);border-color:var(--muted);white-space:nowrap}
.where{margin:2px 0 6px}
ol.top3{list-style:none;padding:0;margin:8px 0}
li.top{display:flex;gap:10px;align-items:flex-start;margin:8px 0;break-inside:avoid}
li.top .rank{flex:none;margin-top:1px}
li.top h3{margin:0 0 2px}li.top p{margin:2px 0}li.top .why{font-size:14px}
.legend{margin:4px 0 8px}
pre.code{margin:6px 0;padding:8px 0;background:var(--bg);border:1px solid var(--line);border-radius:6px;overflow-x:auto}
.ln{display:block;white-space:pre;padding:0 10px}
.ln i{display:inline-block;width:3.2em;color:var(--muted);font-style:normal;user-select:none}
.ln.hit{box-shadow:inset 3px 0 0 var(--bad);background:var(--hit);color:var(--hitfg);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.why{margin:6px 0}
ul.plain{list-style:none;padding:0;margin:6px 0}ul.plain li{padding:5px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
.note{background:var(--card);border-radius:6px;padding:8px 12px}
ol{padding-left:22px}ol li{margin:6px 0}
footer{margin-top:32px;padding-top:12px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
@media (max-width:520px){main{padding:16px 12px}.score .big{font-size:44px}.tag{display:inline-block;margin:4px 0 0}pre.code{font-size:11.5px}}
@media print{
@page{margin:14mm}
body{font-size:11.5px}main{max-width:none;padding:0}
h2{margin:12px 0 6px;break-after:avoid}
.summary .dims{display:grid;grid-template-columns:1fr 1fr;column-gap:16px}
.summary pre.code{display:none}
.finding{padding:6px 10px;margin:6px 0;break-inside:avoid}
li.top{margin:6px 0}li.top .why{font-size:inherit}.explain,.check{font-size:inherit}.suite{margin-bottom:8px}p{margin:2px 0}ol li{margin:3px 0}.legend{font-size:11px;margin:2px 0 4px}
.score .big{font-size:40px}header{padding-bottom:10px}
.details{break-before:page}
pre.code{overflow:visible;white-space:pre-wrap}
}
`;
