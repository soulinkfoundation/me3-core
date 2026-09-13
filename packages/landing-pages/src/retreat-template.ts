/** An immersive, photography-led template for retreat and training businesses. */
export function retreatTemplateCss(): string {
  return `body[data-design-pack=retreat-01]{--bg:#f3efe8;--surface:#eee7dd;--text:#343137;--muted:#625a60;--line:#d9ccbe;--accent:#672321;--accent-contrast:#fff;--consent-accent:#672321;--display-font:"Cormorant Garamond",Georgia,serif;--accent-font:var(--display-font);--body-font:Inter,system-ui,sans-serif;--meta-font:var(--body-font);--footer-bg:#211b20;--footer-text:#cbbba7;background:var(--bg)}
body[data-design-pack=retreat-01] .pack-header{min-height:106px}body[data-design-pack=retreat-01] .pack-brand{display:flex;align-items:center;gap:12px}body[data-design-pack=retreat-01] .pack-brand img{width:46px;height:58px;object-fit:contain}
body[data-design-pack=retreat-01] .pack-brand{font-family:var(--display-font);font-size:2rem}
body[data-design-pack=retreat-01][data-hero-layout=background]>.pack-header{color:#f3efe8}
body[data-design-pack=retreat-01] .pack-hero-background{color:#f3efe8;min-height:100svh}
body[data-design-pack=retreat-01] .pack-hero-background:after{background:linear-gradient(180deg,rgba(21,12,19,.35),rgba(21,12,19,.48))}
body[data-design-pack=retreat-01] .pack-hero-background .pack-hero-grid{min-height:100svh;align-items:center}
body[data-design-pack=retreat-01] .pack-hero-background .pack-hero-copy{padding:160px 0 130px;width:min(100%,960px)}
body[data-design-pack=retreat-01] .pack-hero h1{max-width:22ch;font-size:clamp(3rem,6.4vw,6.6rem);font-weight:500;line-height:1.04;letter-spacing:-.025em}
body[data-design-pack=retreat-01] .pack-hero h1 em{color:inherit;font-style:normal}
body[data-design-pack=retreat-01] .pack-hero-background .pack-hero-copy>p{max-width:660px;color:#f3efe8;font:400 clamp(1rem,1.6vw,1.2rem)/1.65 var(--body-font)}
body[data-design-pack=retreat-01] .pack-hero .pack-kicker,body[data-design-pack=retreat-01] .pack-section-number,body[data-design-pack=retreat-01] .pack-card-number{display:none}
body[data-design-pack=retreat-01] .button{border-radius:4px;text-transform:none;font:500 15px/1.3 var(--body-font);letter-spacing:0}
body[data-design-pack=retreat-01] .pack-hero-background .button.primary{background:#672321;color:#fff;border-color:#672321}
body[data-design-pack=retreat-01] .pack-hero-background .button.secondary{color:#f3efe8;background:transparent;border-color:#f3efe8}
body[data-design-pack=retreat-01] .pack-section{padding:96px 0;border:0}
body[data-design-pack=retreat-01] h2{font:500 clamp(2.6rem,4.8vw,4.6rem)/1.06 var(--display-font);letter-spacing:-.025em}
body[data-design-pack=retreat-01] h3{font:600 2rem/1.12 var(--display-font)}
body[data-design-pack=retreat-01] .pack-section-head{display:block;max-width:820px;margin:0 auto 48px;text-align:center}
body[data-design-pack=retreat-01] .pack-section-head p{font:400 16px/1.7 var(--body-font)}
body[data-design-pack=retreat-01] .pack-features,body[data-design-pack=retreat-01] .pack-image-text,body[data-design-pack=retreat-01] .pack-collection{background:var(--bg)}
body[data-design-pack=retreat-01] .pack-story{background:#342630;color:#f3efe8;--text:#f3efe8;--muted:#ded2d5}
body[data-design-pack=retreat-01] .pack-split{display:block;max-width:900px;text-align:center}
body[data-design-pack=retreat-01] .pack-card-grid{gap:36px;border:0;background:transparent}
body[data-design-pack=retreat-01] .pack-card-grid article{border:0;padding:24px 0;background:transparent;text-align:center}
body[data-design-pack=retreat-01] .pack-collection-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:36px;border:0;background:transparent}
body[data-design-pack=retreat-01] .pack-collection-grid article{padding:0 0 28px;border:0;background:transparent}
body[data-design-pack=retreat-01] .pack-collection-grid img{display:block;width:100%;height:340px;object-fit:cover;margin:0 0 24px;border-radius:3px}
body[data-design-pack=retreat-01] .pack-collection-grid .pack-kicker{display:none}
body[data-design-pack=retreat-01] .pack-text-link{color:#672321}
body[data-design-pack=retreat-01] .pack-media-grid{gap:64px}
body[data-design-pack=retreat-01] .pack-media-grid img{min-height:420px}
body[data-design-pack=retreat-01] .pack-final{background:#e9e0d4}
body[data-design-pack=retreat-01] .pack-footer{background:#211b20;color:#cbbba7}
@media(max-width:900px){body[data-design-pack=retreat-01] .pack-header #pack-site-navigation{background:#211b20;color:#f3efe8}body[data-design-pack=retreat-01] .pack-section{padding:64px 0}body[data-design-pack=retreat-01] .pack-hero-background .pack-hero-copy{padding:150px 0 120px}body[data-design-pack=retreat-01] .pack-collection-grid{grid-template-columns:1fr}body[data-design-pack=retreat-01] .pack-collection-grid img{height:300px}body[data-design-pack=retreat-01] .pack-media-grid{gap:32px}}`;
}
