<p align="center">
  <img src="apps/web/public/me3-logo-light.png" alt="ME3 logo" width="120" />
</p>

<p align="center">Free, open-source software for your AI, email, calendar, website and more.</p>

<p align="center">
  <strong>Ready to take ownership of your digital life? Me too...👇</strong>
</p>

[![ME3 demo](https://me3.app/me3_screenshots.gif)](https://me3.app/me3_screenshots.mp4)


### 🚀 Install in minutes
1. Create a free Cloudflare account.
2. Click here 👇
<p>
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/soulinkfoundation/me3-core">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare" />
  </a>
</p>

### 🖥️ What's in ME3

- **🤖 An AI assistant/agent** you control to save you time. Pick any model from Open Source models to Claude.
- **Tasks and Projects** to organise work and keep priorities moving.
- **🌐 A ME3 site/profile**: it's like a digital business card, built for humans and AI agents.
- **📧 Email** for you or your 🤖, whatever allows you to spend less time on email.
- **📆 A Calendar** your 🤖 can use to help you spend more time on what matters to you.
- **🧩 Plugins**: you can build, extend and modify to make ME3 your own.

Note: Cloudflare hosting is free to start; some features require a $5/month plan. AI costs are extra, depending on the models you configure. R2 storage can be activated later from Account settings for email attachments, assistant images, generated images, and larger site media.

### 🔄 Update ME3

In a Deploy-to-Cloudflare copied repository, run **Actions → Update ME3 → Run workflow**. The updater preserves that installation's `wrangler.toml`, including its Cloudflare resource IDs and bindings. With Cloudflare credentials configured as GitHub secrets, the workflow applies D1 migrations before it pushes or deploys the updated Worker and stops if migration fails. Without those secrets, keep the Cloudflare Workers Builds deploy command set to `pnpm run deploy`; that command also applies migrations before `wrangler deploy` and stops on failure. The in-app installer uses a temporary Cloudflare token for the first deployment, so configure your own deployment connection for later updates.

### 📜 Docs

Point your ME3 or any AI at this [how-to-me3](docs/how-to-me3.md) to find out how to configure your custom domain, run the app locally, create your own plugin and more.

ME3's stable agent character is defined in the [ME3 Character Contract](docs/me3-character.md).

### 😘 Support

ME3 is free and open source. To help support ongoing development and maintenance, visit the [Soulink Foundation](https://soulinkfoundation.org/support)

## License

[MIT](./LICENSE)
