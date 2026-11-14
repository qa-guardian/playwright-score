/** Inline stylesheet for the suite report: light/dark, phone width, Letter/A4 print. */
export const REPORT_CSS = `
:root{--bg:#fff;--fg:#1a1d23;--muted:#5b6472;--line:#e3e6eb;--card:#f6f7f9;--accent:#2f5bea;--hit:#fff1c2;--hitfg:#1a1d23;--good:#1a7f4b;--warn:#b26a00;--bad:#c62828;--track:#e8ebf0}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e8eaee;--muted:#9aa3b2;--line:#2a2e36;--card:#1c1f25;--accent:#7c9bff;--hit:#4a3d10;--hitfg:#fff;--good:#4cc38a;--warn:#f0a63a;--bad:#ff6b6b;--track:#2a2e36}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:820px;margin:0 auto;padding:28px 20px 40px}
header{display:flex;gap:24px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:20px}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:17px;margin:28px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:15px;margin:0 0 4px}
p{margin:4px 0}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}
code{overflow-wrap:anywhere}
.muted{color:var(--muted);font-size:13px}
.meta{color:var(--muted);font-size:13px;margin-top:8px}
.sub{font-weight:600;margin:12px 0 4px}
.score{display:flex;align-items:baseline;gap:2px;padding:14px 20px;border-radius:12px;background:var(--card);border:2px solid var(--muted)}
.score .big{font-size:52px;font-weight:700;line-height:1}
.score .of{color:var(--muted);font-size:16px}
.score .grade{margin-left:12px;font-size:28px;font-weight:700}
.g-A,.g-B{border-color:var(--good)}.g-A .grade,.g-B .grade{color:var(--good)}
.g-C{border-color:var(--warn)}.g-C .grade{color:var(--warn)}
.g-D,.g-F{border-color:var(--bad)}.g-D .grade,.g-F .grade{color:var(--bad)}
.dim{margin:10px 0}.dimhead{display:flex;justify-content:space-between}
.bar{height:10px;background:var(--track);border-radius:5px;overflow:hidden;margin:4px 0}
.bar span{display:block;height:100%;background:var(--accent);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.finding{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--warn);border-radius:8px;padding:12px 14px;margin:12px 0;break-inside:avoid}
.finding.sev-error{border-left-color:var(--bad)}
.rank{display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;background:var(--fg);color:var(--bg);font-size:12px;margin-right:8px}
.tag{font-size:11px;font-weight:600;border:1px solid var(--line);border-radius:10px;padding:1px 8px;margin-left:6px;color:var(--muted);white-space:nowrap}
.tag.high{color:var(--good);border-color:var(--good)}.tag.medium{color:var(--warn);border-color:var(--warn)}
.where{margin:2px 0 6px}
pre.code{margin:6px 0;padding:8px 0;background:var(--bg);border:1px solid var(--line);border-radius:6px;overflow-x:auto}
.ln{display:block;white-space:pre;padding:0 10px}
.ln i{display:inline-block;width:3.2em;color:var(--muted);font-style:normal;user-select:none}
.ln.hit{background:var(--hit);color:var(--hitfg);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.why{margin:6px 0}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line)}
.num{text-align:right;width:80px}
ul.plain{list-style:none;padding:0;margin:6px 0}ul.plain li{padding:5px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
.note{background:var(--card);border-radius:6px;padding:8px 12px}
ol{padding-left:22px}ol li{margin:6px 0}
footer{margin-top:32px;padding-top:12px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
@media (max-width:520px){main{padding:16px 12px}.score .big{font-size:44px}.tag{display:inline-block;margin:4px 0 0}}
@media print{
@page{margin:14mm}
body{font-size:11.5px}main{max-width:none;padding:0}
h2{margin:16px 0 8px;break-after:avoid}.finding{margin:8px 0;padding:8px 10px}
pre.code{overflow:visible;white-space:pre-wrap}
section{break-inside:auto}
}
`;
