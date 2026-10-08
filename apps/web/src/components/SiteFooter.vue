<template>
  <footer class="footer">
    <div class="footer-left">
      <p class="copyright">&copy; 2026 ME3</p>
      <div class="footer-links">
        <a href="/">Home</a>
        <router-link to="/login">Sign in</router-link>
      </div>
    </div>
    <p class="footer-attribution">Open source ME3</p>
  </footer>
</template>

<style scoped>
.footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 16px;
  padding: 40px 20px 24px;
  color: var(--color-text-muted);
  border-top: 1px solid var(--color-border);
  margin-top: auto;
}

.footer-left {
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: center;
  gap: 16px;
  max-width: 100%;
}

.copyright {
  font-size: 14px;
  margin: 0;
}

.footer-links {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 16px;
  justify-content: center;
}

.footer-links a {
  color: var(--color-text-muted);
  text-decoration: none;
  font-size: 14px;
}

.footer-links a:hover {
  text-decoration: underline;
}

.footer-attribution {
  margin: 0;
  font-size: 12px;
}

.footer-attribution a {
  color: var(--color-text-muted);
  text-decoration: none;
}

.footer-attribution a:hover {
  text-decoration: underline;
}

@media (min-width: 768px) {
  .footer {
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    text-align: left;
    gap: 24px;
    padding: 32px 40px 28px;
  }

  .footer-left {
    display: flex;
    justify-content: flex-start;
  }

  .footer-links {
    justify-content: flex-start;
  }

  .footer-attribution {
    text-align: right;
    flex-shrink: 0;
  }
}
</style>
