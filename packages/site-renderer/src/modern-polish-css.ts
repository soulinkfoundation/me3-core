/**
 * Site polish shared by every modern theme and layout: the immersive cover hero, picture cards for writing,
 * one card shadow, button shapes and type per theme, a quieter header and a one-row footer.
 * Appended after the theme stylesheet so these rules settle the final look. Reviewed in the theme lab (lab/).
 */
const SOURCE = String.raw`
/* Menu: lighter, calmer links. */
.site-topbar .nav-link{font-weight:500;letter-spacing:-.005em;color:var(--muted)}
.site-topbar .nav-link.active{background:transparent;color:var(--text);box-shadow:inset 0 -2px 0 var(--accent);border-radius:0}
.site-topbar .nav-link:not(.active):hover{background:transparent;color:var(--text)}
.site-topbar__action{font-weight:600}
.site-topbar__identity{font-weight:600}

/* Cover becomes immersive on desktop: the banner fills the first screen and the header floats over it. */
@media(min-width:761px){
  body[data-page=home][data-layout=cover] .site-topbar{position:fixed;left:0;right:0;background:transparent;border-bottom-color:transparent;transition:background .3s ease,border-color .3s ease,backdrop-filter .3s ease}
  body[data-page=home][data-layout=cover]:not(.is-scrolled) .site-topbar__identity,
  body[data-page=home][data-layout=cover]:not(.is-scrolled) .site-topbar .nav-link,
  body[data-page=home][data-layout=cover]:not(.is-scrolled) .site-topbar .site-theme-toggle{color:#fff;text-shadow:0 1px 12px rgba(0,0,0,.25)}
  body[data-page=home][data-layout=cover]:not(.is-scrolled) .site-topbar .nav-link:not(.active){color:rgba(255,255,255,.82)}
  body[data-page=home][data-layout=cover]:not(.is-scrolled) .site-topbar .nav-link.active{box-shadow:inset 0 -2px 0 #fff}
  body[data-page=home][data-layout=cover] .site-topbar__action{transition:opacity .25s ease,transform .25s ease}
  body[data-page=home][data-layout=cover]:not(.is-scrolled) .site-topbar__action{opacity:0;transform:translateY(-4px);pointer-events:none}
  body[data-page=home][data-layout=cover].is-scrolled .site-topbar{background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:saturate(1.4) blur(14px);-webkit-backdrop-filter:saturate(1.4) blur(14px);border-bottom-color:var(--border)}

  .site-hero--cover{min-height:max(560px,min(94vh,960px));background:#111}
  .site-hero--cover .site-hero__banner img{animation:site-hero-settle 1.6s cubic-bezier(.2,.7,.2,1) both}
  .site-hero--cover .site-hero__intro{width:min(1200px,100%);margin:0 auto;padding:0 48px 76px}
  .site-hero--cover .site-hero__avatar{display:block;width:76px;height:76px;margin:0 0 26px;border-width:2px}
  .site-hero--cover .name{display:block;max-width:14ch;margin:0 0 18px;font-size:clamp(3.6rem,7.2vw,7rem);line-height:.94;letter-spacing:-.045em}
  .site-hero--cover .bio{max-width:min(36rem,100%);margin:0 0 10px;font-size:clamp(1.15rem,1.5vw,1.4rem);line-height:1.45;color:rgba(255,255,255,.9)}
  .site-hero--cover .location{color:rgba(255,255,255,.7);font-size:.95rem}
  .site-hero--cover .buttons{gap:10px;margin:30px 0 0}
  .site-hero--cover .site-hero__intro>*{animation:site-hero-rise .9s cubic-bezier(.2,.7,.2,1) both}
  .site-hero--cover .site-hero__intro>:nth-child(2){animation-delay:.08s}
  .site-hero--cover .site-hero__intro>:nth-child(3){animation-delay:.16s}
  .site-hero--cover .site-hero__intro>:nth-child(n+4){animation-delay:.24s}
  body[data-layout=cover] .site-home-sections{width:min(1200px,calc(100% - 96px))}
}
/* Cover, every width: text stays readable on any photo, one solid button and the rest glass. */
.site-hero--cover .site-hero__banner:after{background:linear-gradient(180deg,rgba(0,0,0,.42) 0,rgba(0,0,0,0) 22%,rgba(0,0,0,.08) 42%,rgba(0,0,0,.74) 100%),radial-gradient(ellipse 80% 70% at 0 100%,rgba(0,0,0,.35),transparent 70%)}
.site-hero--cover .name,.site-hero--cover .bio,.site-hero--cover .location{text-shadow:0 1px 2px rgba(0,0,0,.3),0 4px 28px rgba(0,0,0,.35)}
.site-hero--cover .bio{text-wrap:balance}
.site-hero--cover .cta-button:not(:first-child){background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.4);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);text-shadow:0 1px 2px rgba(0,0,0,.25)}

/* Cover: social icons live in the hero, quiet glass circles under the buttons. */
.site-hero--cover .links{justify-content:flex-start;gap:8px;margin:22px 0 0}
.site-hero--cover .link-item{width:38px;height:38px;color:#fff;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.24);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);transition:background .2s}
.site-hero--cover .link-item:hover{background:rgba(255,255,255,.24)}
.site-hero--cover .link-icon svg{width:17px;height:17px}
@keyframes site-hero-settle{from{transform:scale(1.06)}to{transform:scale(1)}}
@keyframes site-hero-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.site-hero--cover .site-hero__banner img,.site-hero--cover .site-hero__intro>*{animation:none}}

/* Cover on phones: no header bar, a floating glass menu button over the photo, like Card. */
@media(max-width:760px){
  body[data-page=home][data-layout=cover] .site-topbar{position:absolute;top:0;left:0;right:0;background:transparent;border:0}
  body[data-page=home][data-layout=cover] .site-topbar__identity{display:none}
  body[data-page=home][data-layout=cover] .site-topbar .site-menu-trigger{border-radius:50%;color:#fff;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.3);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
  .site-hero--cover{min-height:min(86svh,680px)}
  .site-hero--cover .site-hero__intro{padding:96px 20px 32px}
}

/* Cards share one lift: a hairline edge that reads in dark mode and a soft drop shadow. */
:root{--card-edge:color-mix(in srgb,var(--text) 8%,transparent);--card-shadow:0 1px 2px rgba(0,0,0,.05),0 12px 32px -10px rgba(0,0,0,.18);--card-shadow-hover:0 2px 4px rgba(0,0,0,.06),0 22px 44px -12px rgba(0,0,0,.26)}

/* Work with me: tighter rhythm, the button sits close to its description. */
.site-offer{border:1px solid var(--card-edge);box-shadow:var(--card-shadow)}
.site-offer h3{margin-bottom:10px}
.site-offer p{margin:12px 0 0}
.site-offer__actions{padding-top:20px}

/* Latest writing: picture cards with the post image on top. */
.site-writing__rows{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;border:0}
.site-writing-row{position:relative;display:flex;flex-direction:column;align-items:stretch;gap:0;padding:0;overflow:hidden;border:1px solid var(--card-edge);border-radius:var(--radius);background:var(--surface);box-shadow:var(--card-shadow);transition:transform .25s ease,box-shadow .25s ease}
.site-writing-row:hover{transform:translateY(-3px);box-shadow:var(--card-shadow-hover)}
.site-writing-row__image{width:100%;height:auto;flex:none;aspect-ratio:16/10;border-radius:0;transition:transform .5s cubic-bezier(.2,.7,.2,1)}
.site-writing-row:hover .site-writing-row__image{transform:scale(1.04)}
.site-writing-row__body{gap:8px;padding:16px 18px 18px}
.site-writing-row strong{font-size:1.08rem;line-height:1.3}
.site-writing-row time{order:-1;font-size:.78rem;letter-spacing:.02em;text-transform:uppercase}

/* Cover: the image is the whole card and the words sit on it. */
body[data-layout=cover] .site-writing-row{min-height:0;aspect-ratio:4/5;justify-content:flex-end;padding:0;border-color:transparent;background:linear-gradient(150deg,var(--accent),color-mix(in srgb,var(--accent) 45%,#000))}
body[data-layout=cover] .site-writing-row__image{position:absolute;inset:0;width:100%;height:100%;aspect-ratio:auto;object-fit:cover}
body[data-layout=cover] .site-writing-row:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 35%,rgba(0,0,0,.78) 100%);pointer-events:none}
body[data-layout=cover] .site-writing-row__body{position:relative;z-index:1;padding:22px}
body[data-layout=cover] .site-writing-row strong{color:#fff;font-size:1.35rem;line-height:1.2;text-shadow:0 1px 12px rgba(0,0,0,.3)}
body[data-layout=cover] .site-writing-row time{color:rgba(255,255,255,.78)}

@media(max-width:760px){
  .site-writing__rows{grid-template-columns:1fr;gap:12px}
  .site-writing-row{flex-direction:row;align-items:center}
  .site-writing-row__image{width:96px;height:96px;flex:0 0 96px;aspect-ratio:1}
  .site-writing-row__body{padding:12px 16px}
  body[data-layout=cover] .site-writing__rows{grid-template-columns:1fr}
  body[data-layout=cover] .site-writing-row{flex-direction:column;align-items:stretch;aspect-ratio:16/11}
  body[data-layout=cover] .site-writing-row__image{width:100%;height:100%;flex:none}
}

/* Cover on phones: everything centred, avatar on its own row, less empty photo above it. */
@media(max-width:760px){
  .site-hero--cover{min-height:min(72svh,600px)}
  .site-hero--cover .site-hero__intro{padding:88px 20px 30px;text-align:center}
  .site-hero--cover .site-hero__avatar{display:block;width:72px;height:72px;margin:0 auto 14px;border-width:2px}
  .site-hero--cover .site-hero__avatar--initials{display:flex}
  .site-hero--cover .name{display:block;margin:0 0 10px;font-size:clamp(2.3rem,10vw,2.8rem);line-height:1.02}
  .site-hero--cover .bio,.site-hero--cover .location{margin-left:auto;margin-right:auto}
  .site-hero--cover .links{justify-content:center}
}

/* Newsletter: input and button share one height, the button is slimmer and wider, no dead space below. */
.site-home-sections .newsletter{padding:32px 32px 26px}
.newsletter-form{gap:10px;align-items:stretch}
.newsletter-form input[type=email]{box-sizing:border-box;height:48px;padding:0 16px;border-width:1px;border-radius:var(--button-radius)}
.newsletter-form button{box-sizing:border-box;height:48px;min-height:0;min-width:148px;padding:0 28px;font-weight:600}
.site-home-sections .newsletter-privacy{box-sizing:border-box;width:100%;max-width:560px;margin:12px 0 0;font-size:.85rem;text-align:center;color:var(--muted)}
.newsletter-status:empty{display:none}
@media(max-width:760px){
  .site-home-sections .newsletter{padding:24px 22px 20px}
  .site-home-sections .newsletter-form{flex-direction:column;margin:20px 0 0}
  .newsletter-form input[type=email]{flex:none;width:100%}
  .newsletter-form button{width:100%}
}

/* Header and footer: no rules. The header gains a soft shadow only once the page scrolls under it. */
.site-topbar{border-bottom-color:transparent!important;transition:box-shadow .25s ease,background .3s ease}
body.is-scrolled .site-topbar{box-shadow:0 1px 0 var(--card-edge),0 10px 30px -18px rgba(0,0,0,.35)}
@media(max-width:760px){body.is-scrolled[data-page=home]:is([data-layout=card],[data-layout=cover]) .site-topbar{box-shadow:none}}

/* Footer: one compact row, menu left, copyright centred, social icons right. */
.site-footer{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:20px;padding-top:22px;padding-bottom:22px;border-top:0}
.site-footer__top{display:contents}
.site-footer nav{grid-column:1;gap:16px;font-size:.92rem}
.site-footer>p{grid-column:2;grid-row:1;margin:0;font-size:.8rem;white-space:nowrap}
.site-footer .links{grid-column:3;justify-self:end;margin:0}
.site-footer .link-item{width:36px;height:36px}
.site-footer .link-icon svg{width:17px;height:17px}
@media(max-width:760px){
  .site-footer{grid-template-columns:1fr;justify-items:center;gap:16px;padding-top:28px;padding-bottom:28px;text-align:center}
  .site-footer nav{grid-column:1;justify-content:center}
  .site-footer .links{grid-column:1;justify-self:center;justify-content:center;margin:0!important}
  .site-footer>p{grid-column:1;grid-row:auto;white-space:normal}
}

/* Cover: no action button in the header (the hero carries it), and header, hero and sections share one left edge. */
body[data-layout=cover] .site-topbar__action{display:none!important}
@media(min-width:761px){
  body[data-layout=cover] .site-topbar__inner{width:min(1200px,100%);padding-left:48px;padding-right:48px}
  body[data-layout=cover] .site-home-sections{width:min(1104px,calc(100% - 96px))}

  /* Wide layouts: offers in three columns, newsletter a centred block about 60% wide. */
  body:is([data-layout=cover],[data-layout=split]) .site-offers__grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}
  body:is([data-layout=cover],[data-layout=split]) .site-home-sections .newsletter{box-sizing:border-box;width:min(100%,680px);margin-left:auto;margin-right:auto}
  body:is([data-layout=cover],[data-layout=split]) .site-home-sections .newsletter:not(.has-image){justify-items:center;text-align:center}
  body:is([data-layout=cover],[data-layout=split]) .site-home-sections .newsletter:not(.has-image) :is(.newsletter-title,.newsletter-desc,.newsletter-status){text-align:center}
  body:is([data-layout=cover],[data-layout=split]) .site-home-sections .newsletter:not(.has-image) .newsletter-form{width:100%;max-width:480px}
  body:is([data-layout=cover],[data-layout=split]) .site-home-sections .newsletter:not(.has-image) .newsletter-privacy{max-width:none}
  body:is([data-layout=cover],[data-layout=split]) .site-home-sections .newsletter.has-image{width:min(100%,820px)}
}
@media(min-width:761px){body[data-layout=cover] .site-footer{padding-left:max(48px,calc((100% - 1104px)/2));padding-right:max(48px,calc((100% - 1104px)/2))}}

/* Cover avatar: larger, no ring; a soft shadow lifts it off the photo instead. */
.site-hero--cover .site-hero__avatar{border:0;box-shadow:0 6px 24px rgba(0,0,0,.3)}
@media(min-width:761px){.site-hero--cover .site-hero__avatar{width:104px;height:104px;margin-bottom:28px}}
@media(max-width:760px){.site-hero--cover .site-hero__avatar{width:92px;height:92px;margin-bottom:16px}}

/* Avatars carry the same card shadow as everything else, in every layout. */
.site-hero__avatar,.site-hero--cover .site-hero__avatar{box-shadow:var(--card-shadow)}

/* Buttons: one shape per theme, a calmer weight, and text centred on its capital letters so every font sits in the middle. */
:is(.cta-button,.site-topbar__action,.site-action-dock__button,.site-end-action__button,.site-menu-action,.newsletter-form button,.site-offer button,.booking-continue,.booking-submit){display:inline-block;box-sizing:border-box;height:auto;min-height:0;padding:16px 24px;border-radius:var(--cta-radius);font-family:var(--cta-font);font-size:var(--cta-size);font-weight:600;letter-spacing:var(--cta-tracking);line-height:1;text-align:center;vertical-align:middle;text-box:trim-both cap alphabetic}
@supports(text-box:trim-both cap alphabetic){:is(.cta-button,.site-topbar__action,.site-action-dock__button,.site-end-action__button,.site-menu-action,.newsletter-form button,.site-offer button,.booking-continue,.booking-submit){padding-top:18px;padding-bottom:18px}}
:is(.site-topbar__action,.site-offer button){font-size:min(14px,var(--cta-size));padding-left:20px;padding-right:20px}
@supports(text-box:trim-both cap alphabetic){:is(.site-topbar__action,.site-offer button){padding-top:15px;padding-bottom:15px}}
.cta-button .btn-icon{display:inline-flex;vertical-align:middle;margin-right:8px}
.newsletter-form input[type=email]{border-radius:var(--cta-radius)}
/* The booking steps' dock buttons stay hidden until the renderer's own booking-state rules show them. */
.site-action-dock :is([data-booking-dock-continue],[data-booking-dock-select-time]){display:none}
/* Phones: the header never carries the action button; the bottom dock does. */
@media(max-width:760px){.site-topbar .site-topbar__action{display:none}}
/* Phones: hero buttons are full width, one per row, in every layout. */
@media(max-width:760px){
  :is(.site-hero--split,.site-hero--minimal) .buttons{display:grid;grid-template-columns:1fr;gap:8px}
  :is(.site-hero--split,.site-hero--minimal) .cta-button{width:100%}
}
@media(max-width:760px){.site-hero--split .links{justify-content:center}}

/* Minimal: offers are cards like every other layout, not full-width list rows. */
body[data-layout=minimal] .site-offers__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
body[data-layout=minimal] .site-offer{display:flex;flex-direction:column;align-items:flex-start;padding:24px;border:1px solid var(--card-edge);border-radius:var(--radius);box-shadow:var(--card-shadow)}
body[data-layout=minimal] .site-offer__actions{grid-column:auto;grid-row:auto;align-self:auto}
@media(max-width:760px){body[data-layout=minimal] .site-offers__grid{grid-template-columns:1fr}}
`;

export const modernPolishCss = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n\s*/g, "");
