import { siteThemes, type SiteColorMode, type SiteThemeId } from "./themes";

export function modernSiteCss(themeId: SiteThemeId, colorMode: SiteColorMode, accentOverride?: string): string {
  const theme = siteThemes[themeId];
  const customAccent = /^#[0-9a-f]{6}$/i.test(accentOverride || "") ? accentOverride : undefined;
  const accentText = customAccent
    ? ((parseInt(customAccent.slice(1, 3), 16) * 299 + parseInt(customAccent.slice(3, 5), 16) * 587 + parseInt(customAccent.slice(5, 7), 16) * 114) / 1000 > 150 ? "#111111" : "#ffffff")
    : undefined;
  const paletteCss = (mode: "light" | "dark") => {
    const palette = theme[mode];
    return `--bg:${palette.bg};--surface:${palette.surface};--raised:${palette.raised};--text:${palette.text};--muted:${palette.muted};--border:${palette.border};--accent:${customAccent || palette.accent};--accent-text:${accentText || palette.accentText};color-scheme:${mode}`;
  };
  const autoDark = colorMode === "auto" ? `@media(prefers-color-scheme:dark){html:not([data-color-mode]){${paletteCss("dark")}}}` : "";
  return `:root{${paletteCss(colorMode === "dark" ? "dark" : "light")};--font:${theme.bodyFont};--display-font:${theme.displayFont};--radius:${theme.radius};--radius-sm:${theme.radius};--radius-md:${theme.buttonRadius};--button-radius:${theme.buttonRadius};--name-case:${theme.nameCase};--accent-soft:color-mix(in srgb,var(--accent) 12%,transparent);--ui-shadow-sm:0 4px 16px rgba(0,0,0,.06)}html[data-color-mode=light]{${paletteCss("light")}}html[data-color-mode=dark]{${paletteCss("dark")}}${autoDark}
body{background:var(--bg);color:var(--text);font-family:var(--font)}
.container{background:var(--bg)}
.name,.content h1,.content h2,.content h3,.booking h2,.newsletter h2,.testimonials h2{font-family:var(--display-font)}
.name{text-transform:var(--name-case);font-size:clamp(2.5rem,6vw,4rem);font-weight:600;letter-spacing:-.035em}
.cta-button,.newsletter button,.booking-submit{background:var(--accent);color:var(--accent-text);border-radius:var(--button-radius)}
.cta-button.primary{color:var(--accent-text)}
.cta-button.secondary,.cta-button.outline{background:transparent;color:var(--text);border:1px solid var(--border)}
.nav-link:not(.active):hover{background:var(--accent-soft)}
.nav-link.active{background:var(--raised);color:var(--text)}
.links .link-item,.testimonial-card__avatar,.post-type{background:var(--raised)}
.booking,.newsletter{background:var(--raised);border-radius:var(--radius)}
.booking-card.active{border-color:var(--accent)}
.booking-slot,.booking-card,.testimonial-card,.collection-card,.blog-item,.shop-item,input,select,textarea{background:var(--surface);border-color:var(--border);border-radius:var(--radius)}
.content a,.footer a,.testimonial-link{color:var(--accent);text-decoration-color:color-mix(in srgb,var(--accent) 50%,transparent)}
.avatar{border-color:var(--bg)}
.footer{border-top:1px solid var(--border)}
.container{width:100%;min-height:100vh;display:flex;flex-direction:column}
.site-main{width:min(var(--site-width,680px),calc(100% - 48px));margin:0 auto;flex:1}
body[data-layout=split],body[data-layout=cover]{--site-width:1080px}
body[data-layout=minimal]{--site-width:720px}
body[data-layout=cover] .site-main{width:100%}
body[data-layout=cover] .site-home-sections{width:min(1080px,calc(100% - 48px));margin:52px auto 80px}
.site-topbar{position:sticky;top:0;z-index:40;width:100%;background:var(--bg);border-bottom:1px solid var(--border)}
.site-topbar__inner{box-sizing:border-box;display:flex;align-items:center;gap:20px;width:min(1200px,100%);min-height:70px;margin:auto;padding:8px 24px}
.site-topbar__identity{display:flex;align-items:center;gap:10px;min-width:0;color:var(--text);font-family:var(--display-font);font-weight:700;font-size:1.05rem;text-decoration:none;white-space:nowrap}
.site-topbar__identity img{width:36px;height:36px;border-radius:50%;object-fit:cover}
.site-topbar__identity img.site-topbar__logo{border-radius:0;object-fit:contain}
.site-topbar__identity span{overflow:hidden;text-overflow:ellipsis}
.site-topbar .site-navigation{flex:1;justify-content:flex-end}
.site-topbar .nav-inline{gap:2px}
.site-topbar .nav-link{padding:11px 13px;border-radius:var(--button-radius);font-weight:600}
.site-topbar__action,.site-action-dock__button,.site-end-action__button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 19px;border-radius:var(--button-radius);background:var(--accent);color:var(--accent-text);font:inherit;font-weight:700;text-decoration:none;white-space:nowrap}
.content .site-end-action__button{color:var(--accent-text);box-sizing:border-box;max-width:100%;white-space:normal;text-align:center}
.site-topbar .site-menu-trigger{width:44px;height:44px;min-width:44px;min-height:44px;border-radius:var(--button-radius);box-shadow:none;background:var(--raised)}
.site-topbar .site-menu-panel{background:var(--surface)}
.site-theme-toggle{position:relative;display:grid;width:44px;height:44px;flex:0 0 44px;place-items:center;padding:0;border:0;border-radius:50%;background:transparent;color:var(--muted);cursor:pointer}
.site-theme-icons{position:relative;display:block;width:22px;height:22px;flex:0 0 22px}
.site-theme-icon{position:absolute;width:22px;height:22px;transition:transform .45s ease-out,opacity .3s}
.site-theme-icon--sun{opacity:0;transform:rotate(-90deg) scale(.4)}
.site-theme-icon--moon{opacity:1;transform:rotate(0) scale(1)}
html[data-color-mode=dark] .site-theme-icon--sun{opacity:1;transform:rotate(0) scale(1)}
html[data-color-mode=dark] .site-theme-icon--moon{opacity:0;transform:rotate(90deg) scale(.4)}
.site-theme-toggle--menu{display:none}
.site-menu-action{display:flex;align-items:center;justify-content:center;min-height:44px;margin-top:18px;border-radius:var(--button-radius);background:var(--accent);color:var(--accent-text);font-weight:700;text-decoration:none}
.site-theme-toggle:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
@media(prefers-reduced-motion:reduce){.site-theme-icon{transition:opacity .2s;transform:none!important}}
.site-hero{position:relative;margin:36px auto 0}
.site-hero__banner{height:180px;overflow:hidden;border-radius:var(--radius);background:var(--raised)}
.site-hero__banner img{display:block;width:100%;height:100%;object-fit:cover}
.site-hero__intro{text-align:center}
.site-hero__avatar{display:block;width:116px;height:116px;box-sizing:border-box;margin:-58px auto 0;border:5px solid var(--bg);border-radius:50%;object-fit:cover;background:var(--raised)}
.site-hero .name{margin:18px 0 12px}
.site-hero .bio{max-width:600px;margin:0 auto 14px;font-size:1.13rem;line-height:1.5}
.site-hero .location{margin:0 auto 14px;font-size:.9rem}
.site-hero .buttons{display:flex;justify-content:center;flex-wrap:wrap;margin:18px 0 10px}
.site-hero .cta-button{width:auto;min-width:140px;box-shadow:none}
.site-hero .links{margin:14px 0 0;gap:8px}
.site-hero .link-item{width:40px;height:40px}
.site-hero .link-icon svg{width:20px;height:20px}
.site-hero--split{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);align-items:center;gap:64px;margin-top:56px}
.site-hero--split .site-hero__portrait{aspect-ratio:4/5;overflow:hidden;border-radius:var(--radius);background:var(--raised)}
.site-hero--split .site-hero__portrait .site-hero__avatar{width:100%;height:100%;margin:0;border:0;border-radius:0;object-fit:cover}
.site-hero--split .site-hero__intro{text-align:left}
.site-hero--split .site-hero__intro .name{font-size:clamp(2.7rem,5vw,4.7rem)}
.site-hero--split .bio,.site-hero--split .location{margin-left:0}
.site-hero--split .buttons,.site-hero--split .links{justify-content:flex-start}
.site-hero--cover{min-height:460px;display:flex;align-items:flex-end;overflow:hidden;margin-top:0;border-radius:0;background:var(--text)}
.site-hero--cover .site-hero__banner{position:absolute;inset:0;height:100%;border-radius:0}
.site-hero--cover .site-hero__banner:after{content:"";position:absolute;inset:0;background:linear-gradient(transparent 20%,rgba(0,0,0,.76))}
.site-hero--cover .site-hero__intro{position:relative;z-index:1;box-sizing:border-box;width:100%;padding:40px;color:#fff;text-align:left}
.site-hero--cover .site-hero__avatar{display:inline-block;width:62px;height:62px;margin:0 14px 0 0;border:3px solid #fff;vertical-align:middle}
.site-hero--cover .name{display:inline;vertical-align:middle;color:#fff}
.site-hero--cover .bio,.site-hero--cover .location{margin-left:0;color:#fff}
.site-hero--cover .buttons,.site-hero--cover .links{justify-content:flex-start}
.site-hero--cover .cta-button.primary{background:#fff;color:#222}
.site-hero--cover .cta-button.secondary,.site-hero--cover .cta-button.outline{border-color:#fff;color:#fff}
.site-hero--cover .link-item{color:#fff;background:#ffffff33}
.site-cover-links{width:min(1080px,calc(100% - 48px));margin:24px auto 0}
.site-cover-links .links{justify-content:flex-start;margin:0}
.site-hero--minimal{margin-top:72px}
.site-hero--minimal .site-hero__intro{text-align:left}
.site-hero--minimal .site-hero__avatar{width:64px;height:64px;margin:0;border:0}
.site-hero--minimal .name{font-size:clamp(3.4rem,8vw,6rem)}
.site-hero--minimal .bio,.site-hero--minimal .location{margin-left:0}
.site-hero--minimal .buttons,.site-hero--minimal .links{justify-content:flex-start}
.site-home-sections{margin:52px 0 80px}
.site-home-sections>section{margin:56px 0}
.site-home-sections .newsletter{display:grid;grid-template-columns:1fr 1fr;grid-template-areas:"title form" "desc form" "privacy form" "status status";align-items:center;gap:0 24px;padding:30px;background:var(--raised)}
.site-home-sections .newsletter-title{grid-area:title;margin:0;text-align:left}
.site-home-sections .newsletter-desc{grid-area:desc;margin:8px 0;color:var(--muted);text-align:left}
.site-home-sections .newsletter-form{grid-area:form;display:flex;max-width:none;margin:0}
.site-home-sections .newsletter-privacy{grid-area:privacy;margin:8px 0 0;text-align:left}
.site-home-sections .newsletter-status{grid-area:status}
.site-home-sections .booking,.site-home-sections .testimonials{background:transparent;padding:0}
.site-section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:18px}
.site-section-heading h2{margin:0;font-family:var(--display-font);font-size:1.7rem}
.site-section-heading a{color:var(--muted);font-size:.88rem;font-weight:700;text-decoration:none;white-space:nowrap}
.site-offers__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.site-offer{display:flex;flex-direction:column;align-items:flex-start;padding:24px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);box-shadow:var(--ui-shadow-sm)}
.site-offer h3{margin:0 0 8px;font-family:var(--display-font);font-size:1.45rem}
.site-offer__pills{display:flex;gap:6px}
.site-offer__pills span{padding:3px 9px;border-radius:999px;background:var(--raised);font-size:.78rem;font-weight:700}
.site-offer p{margin:12px 0 16px;color:var(--muted);font-size:.92rem;line-height:1.55}
.site-offer button{min-height:40px;margin-top:auto;padding:0 15px;border:1px solid var(--border);border-radius:var(--button-radius);background:var(--surface);color:var(--text);font:inherit;font-size:.86rem;font-weight:700;cursor:pointer}
.site-offer button:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.site-offer-booking{margin-top:24px}
.site-offer-booking[hidden]{display:none}
.booking,.booking-type-panel,.site-offer-booking{box-sizing:border-box;min-width:0;max-width:100%}
.booking{scroll-margin-top:90px}
.booking-widget{box-sizing:border-box;width:100%;min-width:0;grid-template-columns:minmax(0,1fr)}
.booking-widget>*{min-width:0;max-width:100%;box-sizing:border-box}
.booking-session-preview{display:flex;max-width:100%;min-width:0;overflow-x:auto;scroll-snap-type:x mandatory}
.booking-session-preview .booking-card{box-sizing:border-box;overflow-wrap:anywhere}
.booking-session-preview>.booking-card{flex:0 0 280px;max-width:100%;scroll-snap-align:start}
.booking-session-preview .booking-offer-card{flex:0 0 280px;max-width:calc(100% - 8px);scroll-snap-align:start}
.booking-session-preview .booking-offer-card:only-child{flex:1 1 100%}
.booking-date-picker--strip{box-sizing:border-box;max-width:100%;min-width:0}
.booking-date-picker--strip p{margin:0 0 10px;font-family:var(--display-font);font-size:1.1rem;font-weight:700;text-align:left}
.booking-day-strip{box-sizing:border-box;display:flex;width:100%;max-width:100%;min-width:0;gap:8px;overflow-x:auto;padding:4px 2px 12px;scroll-snap-type:x mandatory}
.booking-day-strip,.booking-session-preview{scrollbar-width:none}
.booking-day-strip::-webkit-scrollbar,.booking-session-preview::-webkit-scrollbar{display:none}
.booking-day{display:grid;flex:0 0 64px;gap:5px;min-height:70px;place-content:center;border:1px solid var(--border);border-radius:var(--button-radius);background:var(--surface);color:var(--text);font:inherit;cursor:pointer;scroll-snap-align:start}
.booking-day span{font-size:.72rem;color:var(--muted)}
.booking-day strong{font-size:1.1rem}
.booking-day[aria-pressed=true]{border-color:var(--accent);background:var(--accent-soft)}
.booking-day:disabled{opacity:.35;cursor:not-allowed}
.booking-day:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.booking-slots:has(.booking-slot-group){display:grid;grid-template-columns:minmax(0,1fr);gap:14px;width:100%;max-width:520px}
.booking-slot-group h4{margin:0 0 9px;font-family:var(--display-font);text-align:left}
.booking-slot-group__buttons{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.booking-slot{font:inherit;border:1px solid var(--border);border-radius:var(--button-radius)}
.booking-slot.active{border-color:var(--accent);outline:2px solid var(--accent)}
.booking-back,.booking-submit{font:inherit;border-radius:var(--button-radius)}
.booking-continue{min-height:44px;padding:0 22px;justify-self:center;border:0;border-radius:var(--button-radius);background:var(--accent);color:var(--accent-text);font:inherit;font-weight:700;cursor:pointer}
.booking-continue:disabled{opacity:.4;cursor:default}
.booking-widget:has(.booking-form.is-visible) .booking-continue{display:none}
.site-writing__rows{border-bottom:1px solid var(--border)}
.site-writing-row{display:grid;grid-template-columns:140px 1fr;align-items:baseline;gap:12px;padding:15px 0;border-top:1px solid var(--border);color:var(--text);text-decoration:none}
.site-writing-row time{color:var(--muted);font-size:.85rem}
.site-writing-row strong{font-family:var(--display-font);font-size:1.2rem}
body[data-layout=cover] .site-writing__rows{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;border:0}
body[data-layout=cover] .site-writing-row{display:flex;min-height:128px;flex-direction:column;justify-content:space-between;padding:22px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)}
body[data-layout=cover] .site-writing-row time{order:2}
body[data-layout=minimal] .site-offers__grid{display:block}
body[data-layout=minimal] .site-offer{display:grid;grid-template-columns:1fr auto;box-shadow:none;border:0;border-top:1px solid var(--border);border-radius:0;padding:18px 0}
body[data-layout=minimal] .site-offer__pills,body[data-layout=minimal] .site-offer p{grid-column:1}
body[data-layout=minimal] .site-offer button{grid-column:2;grid-row:1/4;align-self:center}
.content{box-sizing:border-box;width:min(760px,calc(100% - 48px));margin:64px auto 100px;padding:0;font-size:1.08rem;line-height:1.65;flex:1}
.content h1{font-size:clamp(2.5rem,6vw,4.25rem)}
.content h2{margin-top:1.7em}
.blog-items{gap:0}
.blog-item{grid-template-columns:110px minmax(0,1fr);gap:12px 18px;align-items:baseline;padding:20px 16px;border:0;border-top:1px solid var(--border);border-radius:0;box-shadow:none}
.blog-item--with-image{grid-template-columns:110px minmax(0,1fr) 120px}
.blog-item .blog-item-thumbnail{grid-column:3;grid-row:1 / span 2;width:120px;height:90px;object-fit:cover;align-self:center;border-radius:var(--radius)}
.blog-item-date{grid-column:1;grid-row:1;font-size:.88rem}
.blog-item-title{grid-column:2;grid-row:1;font-family:var(--display-font);font-size:1.3rem}
.blog-item-excerpt{grid-column:2}
.site-end-action{margin-top:72px;padding:32px;border-radius:var(--radius);background:var(--raised)}
.site-end-action h2{margin:0 0 16px}
.site-footer{width:100%;box-sizing:border-box;margin-top:auto;padding:32px max(24px,calc((100% - 1080px)/2));border-top:1px solid var(--border);color:var(--muted)}
.site-footer__top{display:flex;align-items:center;justify-content:space-between;gap:24px}
.site-footer nav{display:flex;flex-wrap:wrap;gap:18px}
.site-footer a{color:inherit;text-decoration:none}
.site-footer .links{margin:0;gap:8px}
.site-footer .link-item{width:40px;height:40px}
.site-footer .link-icon svg{width:19px;height:19px}
.site-footer>p{margin:20px 0 0;font-size:.82rem}
.site-action-dock{display:none}
[data-booking-dock-continue]{display:none;border:0;cursor:pointer}
@media(max-width:760px){
  .site-topbar__inner{min-height:60px;padding:8px 16px}
  .site-topbar__identity{font-size:.92rem}
  .site-topbar__identity img{width:32px;height:32px}
  .site-topbar .nav-inline{display:none}
  .site-topbar .site-menu-trigger{display:inline-flex}
  .site-topbar__action{display:none}
  .site-topbar>.site-topbar__inner>.site-theme-toggle{display:none}
  .site-theme-toggle--menu{display:flex;width:100%;height:52px;justify-content:flex-start;gap:12px;border-radius:0;border-top:1px solid var(--border);font:inherit;text-align:left}
  .site-theme-toggle--menu .site-theme-icons{margin-left:11px}
  body[data-page=home][data-layout=card] .site-topbar{position:absolute;top:0;background:transparent;border:0}
  body[data-page=home][data-layout=card] .site-topbar__identity{display:none}
  body[data-page=home][data-layout=card] .site-topbar .site-menu-trigger{background:var(--surface);border-radius:50%;box-shadow:var(--ui-shadow-sm)}
  .site-main{width:100%}
  .site-hero{margin:0}
  .site-hero__banner{height:190px;border-radius:0 0 var(--radius) var(--radius)}
  .site-hero__intro{padding:0 20px}
  .site-hero .name{font-size:clamp(2.2rem,9vw,3rem)}
  .site-hero .bio{font-size:1rem}
  .site-hero .buttons{display:grid;grid-template-columns:1fr;gap:8px}
  .site-hero .cta-button{width:100%}
  .site-hero--split{display:block;margin:20px 20px 0}
  .site-hero--split .site-hero__portrait{width:100%;max-height:460px;border-radius:var(--radius)}
  .site-hero--split .site-hero__intro{padding:25px 0 0}
  .site-hero--split .buttons,.site-hero--minimal .buttons{display:flex;flex-wrap:wrap}
  .site-hero--split .cta-button,.site-hero--minimal .cta-button{width:auto}
  .site-hero--cover{min-height:520px;border-radius:0}
  .site-hero--cover .site-hero__intro{padding:28px 20px}
  .site-hero--cover .site-hero__avatar{width:48px;height:48px}
  .site-hero--cover .name{font-size:2rem}
  .site-hero--minimal{padding:48px 0 0}
  .site-hero--minimal .name{font-size:3.5rem}
  .site-home-sections{margin:44px 20px 80px}
  body[data-layout=cover] .site-home-sections{width:auto;margin:44px 20px 80px}
  .site-cover-links{width:auto;margin:18px 20px 0}
  body[data-layout=cover] .site-writing__rows{grid-template-columns:1fr}
  .site-offers__grid{grid-template-columns:1fr}
  .booking-slot-group__buttons{grid-template-columns:repeat(2,minmax(0,1fr))}
  .site-writing-row{grid-template-columns:1fr;gap:4px}
  body[data-layout=minimal] .site-offer{display:flex}
  .site-home-sections .newsletter{display:block;padding:22px}
  .site-home-sections .newsletter-form{display:flex;margin:22px 0 12px}
  .content{width:calc(100% - 40px);margin:40px auto 80px}
  .blog-item{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;padding:20px 12px}
  .blog-item--with-image{grid-template-columns:minmax(0,1fr) 88px;gap:8px 14px}
  .blog-item .blog-item-thumbnail{grid-column:2;grid-row:1 / span 3;width:88px;height:88px}
  .blog-item-title,.blog-item-date,.blog-item-excerpt{grid-column:1;grid-row:auto}
  .site-footer{padding:28px 20px}
  body:has(.site-action-dock) .site-footer{padding-bottom:98px}
  .site-footer__top{display:block}
  .site-footer .links{justify-content:flex-start;margin-top:18px}
  .site-action-dock{position:fixed;z-index:45;bottom:0;left:0;right:0;display:block;padding:10px 16px max(10px,env(safe-area-inset-bottom));border-top:1px solid var(--border);background:var(--bg)}
  .site-action-dock__button{box-sizing:border-box;width:100%}
  body:has(.site-action-dock) [data-booking-continue]{display:none}
  body:has(.booking-type-panel:not([hidden]) [data-booking-continue]:not(:disabled)) .site-action-dock a{display:none}
  body:has(.booking-type-panel:not([hidden]) [data-booking-continue]:not(:disabled)) [data-booking-dock-continue]{display:inline-flex}
  body:has(.booking-type-panel:not([hidden]) .booking-form.is-visible) .site-action-dock{display:none}
}
`;
}
