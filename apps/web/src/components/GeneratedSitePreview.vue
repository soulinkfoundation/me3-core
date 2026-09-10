<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from "vue";
import {
  generateSiteHtml,
  type Me3SiteProfile,
} from "@me3-core/site-renderer";
import { useWizardStore, type WizardContentAsset } from "../stores/wizard";

const props = withDefaults(
  defineProps<{
    activeView?: string;
    compact?: boolean;
    editableFooter?: boolean;
  }>(),
  {
    activeView: "home",
    compact: false,
    editableFooter: false,
  },
);

const emit = defineEmits<{
  "edit-footer": [];
}>();

const wizard = useWizardStore();
const frame = ref<HTMLIFrameElement | null>(null);
const generatedFiles = ref<Record<string, string>>({});
const selectedFile = ref("index.html");
const previewHtml = computed(() => generatedFiles.value[selectedFile.value] || generatedFiles.value["index.html"] || "");
let renderVersion = 0;

function blobToDataUrl(blob: Blob | null | undefined): Promise<string | null> {
  if (!blob) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

async function contentWithPreviewAssets(
  content: string,
  assets: WizardContentAsset[],
): Promise<string> {
  if (!content || assets.length === 0) return content;
  const dataUrls = new Map<string, string>();
  await Promise.all(
    assets.map(async (asset) => {
      const dataUrl = await blobToDataUrl(asset.blob);
      if (dataUrl) dataUrls.set(asset.id, dataUrl);
    }),
  );
  if (dataUrls.size === 0) return content;

  const documentValue = new DOMParser().parseFromString(content, "text/html");
  documentValue.querySelectorAll<HTMLImageElement>("img[data-image-id]").forEach((image) => {
    const dataUrl = dataUrls.get(image.dataset.imageId || "");
    if (dataUrl) image.src = dataUrl;
  });
  documentValue
    .querySelectorAll<HTMLElement>("[data-me3-audio][data-asset-id]")
    .forEach((audio) => {
      const dataUrl = dataUrls.get(audio.dataset.assetId || "");
      if (!dataUrl) return;
      audio.dataset.src = dataUrl;
      const source = audio.querySelector<HTMLSourceElement>("audio source");
      if (source) source.setAttribute("src", dataUrl);
    });
  return documentValue.body.innerHTML;
}

function fileForView(view: string | undefined): string {
  if (!view || view === "home") return "index.html";
  const [section, item] = view.split(":", 2);
  if (item) return `${section}/${item}.html`;
  if (section === wizard.blogPath || section === wizard.shopPath) {
    return `${section}/index.html`;
  }
  return `${section}.html`;
}

function previewNavigationScript(currentFile: string): string {
  return `<script>(function(){document.addEventListener('click',function(event){var link=event.target&&event.target.closest?event.target.closest('a'):null;if(!link)return;var href=link.getAttribute('href')||'';if(!href||/^(?:https?:|mailto:|tel:|#)/i.test(href))return;event.preventDefault();parent.postMessage({type:'me3-preview-navigation',href:href,currentFile:${JSON.stringify(currentFile)}},'*');});})();<` + "/script>";
}

function previewBaseHref(currentFile: string): string {
  const username = (wizard.username || wizard.profile.handle || "").trim();
  if (!username) return "";

  const directory = currentFile
    .split("/")
    .slice(0, -1)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const directoryPath = directory ? `${directory}/` : "";
  return `/preview/${encodeURIComponent(username)}/${directoryPath}`;
}

function withPreviewNavigation(html: string, currentFile: string): string {
  const baseHref = previewBaseHref(currentFile);
  const withBase = baseHref
    ? html.replace("<head>", `<head><base href="${baseHref}">`)
    : html;
  return withBase.replace("</body>", `${previewNavigationScript(currentFile)}</body>`);
}

function resolvePreviewFile(href: string, currentFile: string): string {
  const path = new URL(href, `https://preview.local/${currentFile}`).pathname.replace(/^\//, "");
  if (!path) return "index.html";
  if (path.endsWith("/")) return `${path}index.html`;
  return /\.[a-z0-9]+$/i.test(path) ? path : `${path}.html`;
}

function handleMessage(event: MessageEvent) {
  if (event.source !== frame.value?.contentWindow) return;
  const data = event.data as { type?: unknown; href?: unknown; currentFile?: unknown } | null;
  if (
    data?.type !== "me3-preview-navigation" ||
    typeof data.href !== "string" ||
    typeof data.currentFile !== "string"
  ) {
    return;
  }
  const nextFile = resolvePreviewFile(data.href, data.currentFile);
  if (generatedFiles.value[nextFile]) selectedFile.value = nextFile;
}

watch(
  () => props.activeView,
  (view) => {
    const nextFile = fileForView(view);
    selectedFile.value = generatedFiles.value[nextFile] ? nextFile : "index.html";
  },
  { immediate: true },
);

watchEffect(async () => {
  const version = ++renderVersion;
  const profile = wizard.generateMe3Json() as unknown as Me3SiteProfile;
  const logoUrl = wizard.profile.logo;
  const logoBlob = wizard.profile.logoBlob;
  const avatarUrl = wizard.profile.avatar;
  const avatarBlob = wizard.profile.avatarBlob;
  const bannerUrl = wizard.profile.banner;
  const bannerBlob = wizard.profile.bannerBlob;
  const testimonials = wizard.publishableTestimonials().map((testimonial) => ({
    avatar: testimonial.avatar,
    avatarBlob: testimonial.avatarBlob,
  }));
  const pages = wizard.pages.map((page) => ({
    name: `${page.slug}.md`,
    content: page.content,
    images: [...(page.images || [])],
  }));
  const posts = wizard.blogEnabled
    ? wizard.posts.map((post) => ({
        name: `blog/${post.slug}.md`,
        content: post.content,
        images: [...(post.images || [])],
      }))
    : [];
  const products = wizard.shopEnabled
    ? wizard.products.map((product) => ({
        name: `shop/${product.slug}.md`,
        content: product.content,
        images: [...(product.images || [])],
      }))
    : [];

  profile.logo = (await blobToDataUrl(logoBlob)) || logoUrl || undefined;
  profile.avatar = (await blobToDataUrl(avatarBlob)) || avatarUrl || undefined;
  profile.banner = (await blobToDataUrl(bannerBlob)) || bannerUrl || undefined;
  if (profile.testimonials) {
    await Promise.all(
      profile.testimonials.map(async (testimonial, index) => {
        testimonial.avatar =
          (await blobToDataUrl(testimonials[index]?.avatarBlob)) ||
          testimonials[index]?.avatar ||
          testimonial.avatar;
      }),
    );
  }

  const sourceFiles = await Promise.all(
    [...pages, ...posts, ...products].map(async (file) => ({
      name: file.name,
      content: await contentWithPreviewAssets(file.content, file.images),
    })),
  );
  const output = await generateSiteHtml(profile, sourceFiles, { productCheckoutEnabled: false });
  if (version !== renderVersion) return;

  generatedFiles.value = Object.fromEntries(
    Object.entries(output)
      .filter(([name]) => name.endsWith(".html"))
      .map(([name, html]) => [name, withPreviewNavigation(html, name)]),
  );
  const requestedFile = fileForView(props.activeView);
  selectedFile.value = generatedFiles.value[requestedFile] ? requestedFile : "index.html";
});

onMounted(() => window.addEventListener("message", handleMessage));
onBeforeUnmount(() => window.removeEventListener("message", handleMessage));
</script>

<template>
  <div class="generated-site-preview" :class="{ compact }">
    <span class="sr-only">Preview of {{ wizard.profile.name || "your site" }}</span>
    <iframe
      v-if="previewHtml"
      ref="frame"
      :srcdoc="previewHtml"
      sandbox="allow-scripts"
      title="Generated site preview"
    />
    <div v-else class="preview-loading" role="status">Generating preview…</div>
    <button
      v-if="editableFooter"
      type="button"
      class="edit-footer-button"
      @click="emit('edit-footer')"
    >
      Edit footer
    </button>
  </div>
</template>

<style scoped>
.generated-site-preview {
  position: relative;
  width: 100%;
  height: min(760px, calc(100vh - 80px));
  min-height: 560px;
  overflow: hidden;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-lg, 16px);
  background: var(--ui-surface, #fff);
  box-shadow: var(--ui-shadow-md, 0 4px 24px rgba(0, 0, 0, 0.1));
}

.generated-site-preview:not(.compact) {
  height: 760px;
}

iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #fff;
}

.preview-loading {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  box-sizing: border-box;
  padding: 20px;
  color: var(--ui-text-muted, var(--color-text-muted));
  text-align: center;
}

.edit-footer-button {
  position: absolute;
  right: 14px;
  bottom: 14px;
  min-height: 44px;
  padding: 0 15px;
  border: 1px solid var(--ui-border-strong, #232428);
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface, #fff);
  color: var(--ui-text, #232428);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  box-shadow: var(--ui-shadow-sm, 0 2px 8px rgba(0, 0, 0, 0.12));
}

.edit-footer-button:focus-visible {
  outline: 3px solid var(--ui-accent, #3d9b7c);
  outline-offset: 2px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
