<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount, provide, nextTick } from "vue";
import type { Component } from "vue";
import {
  useEditor,
  EditorContent,
  VueNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/vue-3";
import { Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { compressImage, resizeImage } from "@/utils/imageCompression";
import UiIcon from "./UiIcon.vue";
import TiptapImageNode from "./TiptapImageNode.vue";
import TiptapFaqNode from "./TiptapFaqNode.vue";
import TiptapCarouselNode from "./TiptapCarouselNode.vue";
import TiptapSiteBlockNode from "./TiptapSiteBlockNode.vue";
import TiptapCtaNode from "./TiptapCtaNode.vue";
import TiptapAudioNode from "./TiptapAudioNode.vue";
import {
  SITE_AUDIO_ACCEPT,
  audioContentTypeForFile,
  audioExtensionForContentType,
  normalizeSiteAudioFile,
  validateSiteAudioFile,
  type SiteContentAsset,
} from "../utils/siteContentAssets";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    ariaLabel?: string;
    /** Tailors the shared editor to a full site, narrow workspace, or email campaign. */
    variant?: "default" | "workspace" | "campaign" | "section";
    /** Optional title shown below the toolbar (e.g. journal entry title). */
    showTitleField?: boolean;
    title?: string;
    titlePlaceholder?: string;
    titleMaxLength?: number;
    titleDisabled?: boolean;
    uploadImage?: (input: {
      blob: Blob;
      id: string;
      filename: string;
      mimeType: string;
      ext: string;
    }) => Promise<{ src: string; id?: string }>;
  }>(),
  {
    variant: "default",
    showTitleField: false,
    title: "",
    titlePlaceholder: "Untitled",
    titleMaxLength: 180,
    titleDisabled: false,
  },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "update:title", value: string): void;
  (e: "assetAdded", asset: SiteContentAsset): void;
  (e: "assetRemoved", assetId: string): void;
  (
    e: "imageAdded",
    image: { id: string; blob: Blob; mimeType: string; ext: string }
  ): void;
  (e: "imageRemoved", imageId: string): void;
}>();

const isSectionVariant = computed(() => props.variant === "section");

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const allowedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const GALLERY_LAYOUT = "masonry";
const FAQ_QUESTION_FALLBACK = "Question";
const FAQ_ANSWER_FALLBACK = "Answer";
const CAROUSEL_IMAGE_PROVIDER_KEY = "tiptap-carousel-image-provider";

type FaqItem = {
  question: string;
  answer: string;
};

type CarouselItem = {
  title: string;
  body: string;
  image?: string;
  imageId?: string;
  link?: string;
};

type CarouselImageResult = {
  id: string;
  dataUrl: string;
};

type CarouselImageProvider = {
  uploadFile: (file: File) => Promise<CarouselImageResult>;
  uploadRandom: () => Promise<CarouselImageResult>;
};

type SiteBlockType = "newsletter" | "testimonials";
type CtaButtonStyle = "primary" | "secondary" | "outline";

function parseImageWidth(value: string | null): number | string | null {
  if (!value) return null;
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  return value;
}

const ImageWithId = Image.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      "data-image-id": {
        default: null,
        renderHTML: (attributes) => {
          if (!attributes["data-image-id"]) return {};
          return { "data-image-id": attributes["data-image-id"] };
        },
      },
      caption: {
        default: null,
      },
      width: {
        default: null,
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-tiptap-image]",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const img = element.querySelector("img");
          if (!img) return false;
          const captionEl = element.querySelector("figcaption");
          const caption = captionEl?.textContent?.trim() || null;
          return {
            src: img.getAttribute("src"),
            alt: img.getAttribute("alt"),
            title: img.getAttribute("title"),
            "data-image-id": img.getAttribute("data-image-id"),
            caption,
            width: parseImageWidth(img.getAttribute("width")),
          };
        },
      },
      {
        tag: "img[src]",
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const { caption, width, ...rest } = HTMLAttributes;
    const imgAttrs: Record<string, any> = { ...rest };
    if (width) {
      imgAttrs.width = width;
    }
    const captionText = typeof caption === "string" ? caption.trim() : "";
    if (captionText) {
      return [
        "figure",
        { "data-tiptap-image": "true", class: "tiptap-image-figure" },
        ["img", imgAttrs],
        ["figcaption", { class: "tiptap-figcaption" }, captionText],
      ];
    }
    return ["img", imgAttrs];
  },
  addNodeView() {
    return VueNodeViewRenderer(TiptapImageNode as Component<NodeViewProps>);
  },
});

const Gallery = Node.create({
  name: "gallery",
  group: "block",
  content: "image+",
  isolating: true,
  defining: true,
  parseHTML() {
    return [{ tag: "div[data-gallery]" }, { tag: "div.tiptap-gallery" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-gallery": "true",
        "data-layout": GALLERY_LAYOUT,
        class: "tiptap-gallery layout-masonry",
      }),
      0,
    ];
  },
});

function parseFaqItems(element: HTMLElement): FaqItem[] {
  const details = Array.from(element.querySelectorAll("details"));
  return details
    .map((detail) => {
      const summary = detail.querySelector("summary");
      const answer = detail.querySelector(".tiptap-faq-answer");
      return {
        question: summary?.textContent?.trim() || "",
        answer: answer?.textContent?.trim() || "",
      };
    })
    .filter((item) => item.question || item.answer);
}

function parseCarouselItems(element: HTMLElement): CarouselItem[] {
  const slides = Array.from(element.querySelectorAll(".tiptap-carousel-slide"));
  const items: CarouselItem[] = [];
  for (const slide of slides) {
    const card = slide.querySelector(
      ".tiptap-carousel-card",
    ) as HTMLElement | null;
    if (!card) continue;
    const img = card.querySelector("img");
    const title = card.querySelector(".tiptap-carousel-title");
    const body = card.querySelector(".tiptap-carousel-body");
    const link =
      card instanceof HTMLAnchorElement ? card.getAttribute("href") : "";
    items.push({
      title: title?.textContent?.trim() || "",
      body: body?.textContent?.trim() || "",
      image: img?.getAttribute("src") || "",
      imageId: img?.getAttribute("data-image-id") || "",
      link: link || "",
    });
  }
  return items;
}

function normalizeCarouselUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

const FaqBlock = Node.create({
  name: "faqBlock",
  group: "block",
  atom: true,
  isolating: true,
  draggable: true,
  addAttributes() {
    return {
      items: {
        default: [],
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-tiptap-faq]",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          return { items: parseFaqItems(element) };
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const items: FaqItem[] = Array.isArray(node.attrs.items)
      ? node.attrs.items
      : [];
    const resolved = items.length
      ? items
      : [{ question: FAQ_QUESTION_FALLBACK, answer: FAQ_ANSWER_FALLBACK }];
    const details = resolved.map((item) => [
      "details",
      { class: "tiptap-faq-item" },
      [
        "summary",
        { class: "tiptap-faq-question" },
        item.question || FAQ_QUESTION_FALLBACK,
      ],
      [
        "div",
        { class: "tiptap-faq-answer" },
        ["p", {}, item.answer || FAQ_ANSWER_FALLBACK],
      ],
    ]);
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-tiptap-faq": "true",
        class: "tiptap-faq",
      }),
      ...details,
    ];
  },
  addNodeView() {
    return VueNodeViewRenderer(TiptapFaqNode as Component<NodeViewProps>);
  },
});

const CarouselBlock = Node.create({
  name: "carouselBlock",
  group: "block",
  atom: true,
  isolating: true,
  draggable: true,
  addAttributes() {
    return {
      items: {
        default: [],
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-tiptap-carousel]",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          return { items: parseCarouselItems(element) };
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const items: CarouselItem[] = Array.isArray(node.attrs.items)
      ? node.attrs.items
      : [];
    const resolved = items.length
      ? items
      : [
          {
            title: "Headline",
            body: "Add a short description here.",
            image: "",
            link: "",
          },
        ];
    const slides = resolved.map((item) => {
      const content: any[] = [];
      if (item.image) {
        const imgAttrs: Record<string, any> = {
          class: "tiptap-carousel-image",
          src: item.image,
          alt: item.title || "",
        };
        if (item.imageId) {
          imgAttrs["data-image-id"] = item.imageId;
        }
        content.push(["img", imgAttrs]);
      }
      if (item.title) {
        content.push([
          "div",
          { class: "tiptap-carousel-title" },
          item.title,
        ]);
      }
      if (item.body) {
        content.push([
          "div",
          { class: "tiptap-carousel-body" },
          item.body,
        ]);
      }
      const link = item.link ? normalizeCarouselUrl(item.link) : "";
      const card = link
        ? [
            "a",
            {
              class: "tiptap-carousel-card",
              href: link,
              target: "_blank",
              rel: "noopener",
            },
            ...content,
          ]
        : ["div", { class: "tiptap-carousel-card" }, ...content];

      return ["div", { class: "tiptap-carousel-slide" }, card];
    });
    const dots = resolved.map((_, index) => [
      "button",
      {
        class: `carousel-dot${index === 0 ? " active" : ""}`,
        type: "button",
        "aria-label": `Go to card ${index + 1}`,
      },
    ]);
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-tiptap-carousel": "true",
        class: "tiptap-carousel",
      }),
      ["div", { class: "tiptap-carousel-viewport" }, ["div", { class: "tiptap-carousel-track" }, ...slides]],
      ["div", { class: "tiptap-carousel-dots" }, ...dots],
    ];
  },
  addNodeView() {
    return VueNodeViewRenderer(TiptapCarouselNode as Component<NodeViewProps>);
  },
});

const SiteBlock = Node.create({
  name: "siteBlock",
  group: "block",
  atom: true,
  isolating: true,
  draggable: true,
  addAttributes() {
    return {
      blockType: {
        default: "newsletter",
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-me3-site-block]",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const blockType = element.getAttribute("data-me3-site-block");
          if (blockType !== "newsletter" && blockType !== "testimonials") {
            return false;
          }
          return { blockType };
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const blockType: SiteBlockType =
      node.attrs.blockType === "testimonials" ? "testimonials" : "newsletter";
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-me3-site-block": blockType,
      }),
      "\u200b",
    ];
  },
  addNodeView() {
    return VueNodeViewRenderer(TiptapSiteBlockNode as Component<NodeViewProps>);
  },
});

const CtaButtonBlock = Node.create({
  name: "ctaButtonBlock",
  group: "block",
  atom: true,
  isolating: true,
  draggable: true,
  addAttributes() {
    return {
      text: { default: "Learn more", renderHTML: () => ({}) },
      url: { default: "", renderHTML: () => ({}) },
      style: { default: "primary", renderHTML: () => ({}) },
      icon: { default: "", renderHTML: () => ({}) },
      context: { default: "site", renderHTML: () => ({}) },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-me3-cta-button]",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const rawStyle = element.getAttribute("data-style");
          const style: CtaButtonStyle =
            rawStyle === "secondary" || rawStyle === "outline"
              ? rawStyle
              : "primary";
          return {
            text: element.getAttribute("data-text") || "Learn more",
            url: element.getAttribute("data-url") || "",
            style,
            icon: element.getAttribute("data-icon") || "",
            context: element.getAttribute("data-context") === "campaign"
              ? "campaign"
              : "site",
          };
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const style: CtaButtonStyle =
      node.attrs.style === "secondary" || node.attrs.style === "outline"
        ? node.attrs.style
        : "primary";
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-me3-cta-button": "true",
        "data-text": String(node.attrs.text || ""),
        "data-url": String(node.attrs.url || ""),
        "data-style": style,
        "data-icon": String(node.attrs.icon || ""),
        "data-context": node.attrs.context === "campaign" ? "campaign" : "site",
      }),
      "\u200b",
    ];
  },
  addNodeView() {
    return VueNodeViewRenderer(TiptapCtaNode as Component<NodeViewProps>);
  },
});

const AudioBlock = Node.create({
  name: "audioBlock",
  group: "block",
  atom: true,
  isolating: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: "", renderHTML: () => ({}) },
      path: { default: "", renderHTML: () => ({}) },
      type: { default: "audio/mpeg", renderHTML: () => ({}) },
      title: { default: "Audio", renderHTML: () => ({}) },
      assetId: { default: "", renderHTML: () => ({}) },
    };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-me3-audio]",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const source = element.querySelector("audio source");
          return {
            src:
              element.getAttribute("data-src") ||
              source?.getAttribute("src") ||
              "",
            path: element.getAttribute("data-path") || "",
            type:
              element.getAttribute("data-type") ||
              source?.getAttribute("type") ||
              "audio/mpeg",
            title:
              element.getAttribute("data-title") ||
              element.querySelector("figcaption")?.textContent ||
              "Audio",
            assetId: element.getAttribute("data-asset-id") || "",
          };
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const src = String(node.attrs.src || "");
    const path = String(node.attrs.path || "");
    const type = String(node.attrs.type || "audio/mpeg");
    const title = String(node.attrs.title || "Audio");
    const assetId = String(node.attrs.assetId || "");
    return [
      "figure",
      mergeAttributes(HTMLAttributes, {
        "data-me3-audio": "true",
        "data-asset-id": assetId,
        "data-src": src,
        "data-path": path,
        "data-type": type,
        "data-title": title,
        class: "content-audio",
      }),
      ["figcaption", {}, title],
      [
        "audio",
        {
          controls: "true",
          preload: "metadata",
          "aria-label": `Audio player: ${title}`,
        },
        ["source", { src, type }],
        "Your browser does not support audio playback.",
      ],
    ];
  },
  addNodeView() {
    return VueNodeViewRenderer(TiptapAudioNode as Component<NodeViewProps>);
  },
});

function parseYouTubeTimestamp(value: string | null): number | null {
  if (!value) return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }

  const tokenMatch = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (tokenMatch && tokenMatch[0]) {
    const hours = Number(tokenMatch[1] || 0);
    const minutes = Number(tokenMatch[2] || 0);
    const seconds = Number(tokenMatch[3] || 0);
    const total = hours * 3600 + minutes * 60 + seconds;
    return total > 0 ? total : null;
  }

  const parts = raw.split(":").map((part) => Number(part));
  if (
    (parts.length === 2 || parts.length === 3) &&
    parts.every((part) => Number.isFinite(part) && part >= 0)
  ) {
    return parts.reduce((total, part) => total * 60 + part, 0);
  }

  return null;
}

function extractYouTubeVideoId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  try {
    const candidate =
      raw.startsWith("http://") || raw.startsWith("https://")
        ? raw
        : `https://${raw}`;
    const url = new URL(candidate);
    const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
    const pathParts = url.pathname.split("/").filter(Boolean);

    if (hostname === "youtu.be") {
      return pathParts[0] || null;
    }

    if (
      hostname === "youtube.com" ||
      hostname === "m.youtube.com" ||
      hostname === "youtube-nocookie.com"
    ) {
      if (pathParts[0] === "watch") {
        return url.searchParams.get("v");
      }

      if (
        (pathParts[0] === "embed" ||
          pathParts[0] === "shorts" ||
          pathParts[0] === "live") &&
        pathParts[1]
      ) {
        return pathParts[1];
      }
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeYouTubeEmbedUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  try {
    const candidate =
      raw.startsWith("http://") || raw.startsWith("https://")
        ? raw
        : `https://${raw}`;
    const url = new URL(candidate);
    const videoId = extractYouTubeVideoId(candidate);

    if (!videoId || !/^[A-Za-z0-9_-]{6,}$/.test(videoId)) {
      return null;
    }

    const hashStart = url.hash.startsWith("#t=")
      ? parseYouTubeTimestamp(url.hash.slice(3))
      : null;
    const queryStart =
      parseYouTubeTimestamp(url.searchParams.get("start")) ??
      parseYouTubeTimestamp(url.searchParams.get("t"));
    const start = queryStart ?? hashStart;

    const embedUrl = new URL(
      `https://www.youtube-nocookie.com/embed/${videoId}`,
    );
    embedUrl.searchParams.set("rel", "0");
    if (start && start > 0) {
      embedUrl.searchParams.set("start", String(start));
    }

    return embedUrl.toString();
  } catch {
    return null;
  }
}

const YouTubeEmbed = Node.create({
  name: "youtubeEmbed",
  group: "block",
  atom: true,
  isolating: true,
  draggable: true,
  addAttributes() {
    return {
      src: {
        default: "",
        renderHTML: (attributes) => {
          if (!attributes.src) return {};
          return { "data-youtube-src": attributes.src };
        },
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-tiptap-youtube]",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const iframe = element.querySelector("iframe");
          const src =
            iframe?.getAttribute("src") ||
            element.getAttribute("data-youtube-src") ||
            "";
          const normalized = normalizeYouTubeEmbedUrl(src);
          if (!normalized) return false;
          return { src: normalized };
        },
      },
      {
        tag: "div.tiptap-youtube",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const iframe = element.querySelector("iframe");
          const normalized = normalizeYouTubeEmbedUrl(
            iframe?.getAttribute("src") || "",
          );
          if (!normalized) return false;
          return { src: normalized };
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    // Attribute `src` is rendered as `data-youtube-src` only, so it is not
    // present on HTMLAttributes as `src` — read from the node attrs.
    const rawSrc =
      (typeof node.attrs.src === "string" && node.attrs.src) ||
      (HTMLAttributes["data-youtube-src"] as string | undefined) ||
      "";
    const src = normalizeYouTubeEmbedUrl(String(rawSrc));
    if (!src) {
      return ["p", {}, "Invalid YouTube embed"];
    }

    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-tiptap-youtube": "true",
        "data-youtube-src": src,
        class: "tiptap-youtube",
      }),
      [
        "iframe",
        {
          src,
          title: "YouTube video player",
          allow:
            "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
          allowfullscreen: "true",
          referrerpolicy: "strict-origin-when-cross-origin",
        },
      ],
    ];
  },
});

type PendingAsset = SiteContentAsset;

const editor = useEditor({
  content: props.modelValue,
  editorProps: {
    attributes: {
      ...(props.ariaLabel ? { "aria-label": props.ariaLabel } : {}),
      "aria-multiline": "true",
      role: "textbox",
    },
  },
  extensions: [
    StarterKit.configure({
      heading: {
        levels:
          props.variant === "campaign"
            ? [1, 2]
            : props.variant === "section"
              ? [2, 3]
              : [1, 2, 3],
      },
      bulletList: {},
      orderedList: props.variant === "campaign" ? false : {},
      blockquote: props.variant === "campaign" ? false : {},
      code: props.variant === "campaign" ? false : {},
      codeBlock: props.variant === "campaign" ? false : {},
      strike: props.variant === "campaign" ? false : {},
      horizontalRule: false,
      link: false,
      underline: false,
    }),
    Placeholder.configure({
      placeholder: props.placeholder ?? "Start writing...",
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: {
        target: "_blank",
        rel: "noopener noreferrer",
      },
    }),
    Underline,
    HorizontalRule.configure({
      HTMLAttributes: {
        class: "tiptap-divider",
      },
    }),
    TaskList.configure({
      HTMLAttributes: {
        class: "tiptap-task-list",
      },
    }),
    TaskItem.configure({
      nested: true,
      HTMLAttributes: {
        class: "tiptap-task-item",
      },
    }),
    Gallery,
    FaqBlock,
    CarouselBlock,
    SiteBlock,
    CtaButtonBlock,
    AudioBlock,
    YouTubeEmbed,
    ImageWithId.configure({
      inline: false,
      allowBase64: true,
    }),
  ],
  onUpdate: ({ editor }) => {
    emit("update:modelValue", editor.getHTML());
    syncActiveAssets();
  },
  onCreate: () => {
    syncActiveAssets();
  },
});

const showLinkModal = ref(false);
const linkUrl = ref("");
const linkError = ref<string | null>(null);
const showYouTubeModal = ref(false);
const youtubeUrl = ref("");
const youtubeError = ref<string | null>(null);
const youtubeInputRef = ref<HTMLInputElement | null>(null);

const imageError = ref<string | null>(null);
const isProcessingImage = ref(false);
const imageInputRef = ref<HTMLInputElement | null>(null);
const audioInputRef = ref<HTMLInputElement | null>(null);
const isProcessingAudio = ref(false);
const pendingAssets = ref(new Map<string, PendingAsset>());
const lastActiveAssetIds = ref(new Set<string>());
const imageInsertMode = ref<"single" | "gallery">("single");
const DEFAULT_FAQ_ITEMS: FaqItem[] = [
  {
    question: "What do you offer?",
    answer: "Share a short answer that sets expectations.",
  },
  {
    question: "How can people work with you?",
    answer: "Explain next steps and availability.",
  },
];
const DEFAULT_CAROUSEL_ITEMS: CarouselItem[] = [
  {
    title: "Feature highlight",
    body: "Summarize the key benefit in one short paragraph.",
    image: "",
    link: "",
  },
  {
    title: "Use case",
    body: "Describe who this is for and why it matters.",
    image: "",
    link: "",
  },
  {
    title: "Proof or result",
    body: "Share a concrete outcome or example.",
    image: "",
    link: "",
  },
];

async function fetchWithTimeout(input: RequestInfo | URL, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function prepareImageAsset(
  blob: Blob,
  filename = "journal-image",
): Promise<CarouselImageResult> {
  if (blob.type && !allowedImageTypes.has(blob.type)) {
    throw new Error("Please upload a JPEG, PNG, WebP, or GIF image.");
  }

  if (props.variant === "campaign") {
    if (!["image/jpeg", "image/png", "image/gif"].includes(blob.type)) {
      throw new Error("Campaigns support JPEG, PNG, or GIF images.");
    }
    if (blob.size > 5 * 1024 * 1024) {
      throw new Error("Campaign images must be 5 MB or smaller.");
    }
    const imageId = makeImageId();
    const ext = extForMime(blob.type);
    const uploadFilename = ensureImageFilename(filename, ext);
    if (props.uploadImage) {
      const uploaded = await props.uploadImage({
        blob,
        id: imageId,
        filename: uploadFilename,
        mimeType: blob.type,
        ext,
      });
      return { id: uploaded.id || imageId, dataUrl: uploaded.src };
    }
  }

  const resized = await resizeImage(blob, 1600);
  const compressed = await compressImage(resized.blob, MAX_IMAGE_BYTES);

  const imageId = makeImageId();
  const ext = extForMime(compressed.type);
  const uploadFilename = ensureImageFilename(filename, ext);

  if (props.uploadImage) {
    const uploaded = await props.uploadImage({
      blob: compressed.blob,
      id: imageId,
      filename: uploadFilename,
      mimeType: compressed.type,
      ext,
    });
    return { id: uploaded.id || imageId, dataUrl: uploaded.src };
  }

  const dataUrl = await blobToDataUrl(compressed.blob);

  pendingAssets.value.set(imageId, {
    id: imageId,
    kind: "image",
    blob: compressed.blob,
    tempUrl: dataUrl,
    mimeType: compressed.type,
    ext,
    filename: uploadFilename,
  });

  return { id: imageId, dataUrl };
}

async function uploadCarouselFile(file: File): Promise<CarouselImageResult> {
  return prepareImageAsset(file, file.name);
}

async function uploadRandomCarouselImage(): Promise<CarouselImageResult> {
  const seed = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const url = `https://picsum.photos/seed/${encodeURIComponent(seed)}/1200/900`;
  const res = await fetchWithTimeout(url, 10_000);
  if (!res.ok) {
    throw new Error("Couldn't load a random image. Please try again.");
  }
  const blob = await res.blob();
  return prepareImageAsset(blob, "random-image.jpg");
}

provide(CAROUSEL_IMAGE_PROVIDER_KEY, {
  uploadFile: uploadCarouselFile,
  uploadRandom: uploadRandomCarouselImage,
} as CarouselImageProvider);

function extractAssetIdsFromNode(node: any, ids: Set<string>) {
  if (!node) return;
  if (node.type === "image") {
    const id = node.attrs?.["data-image-id"];
    if (typeof id === "string" && id) ids.add(id);
  }
  if (node.type === "audioBlock") {
    const id = node.attrs?.assetId;
    if (typeof id === "string" && id) ids.add(id);
  }
  const content = node.content;
  if (Array.isArray(content)) {
    for (const child of content) extractAssetIdsFromNode(child, ids);
  }
}

function getActiveAssetIds(ed: any): Set<string> {
  const ids = new Set<string>();
  try {
    const doc = ed?.getJSON?.();
    extractAssetIdsFromNode(doc, ids);
  } catch {
    // ignore
  }
  try {
    const html = ed?.getHTML?.() || "";
    if (html) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const images = Array.from(doc.querySelectorAll("img[data-image-id]"));
      for (const img of images) {
        const id = img.getAttribute("data-image-id");
        if (id) ids.add(id);
      }
      const audioBlocks = Array.from(
        doc.querySelectorAll("[data-me3-audio][data-asset-id]"),
      );
      for (const audio of audioBlocks) {
        const id = audio.getAttribute("data-asset-id");
        if (id) ids.add(id);
      }
    }
  } catch {
    // ignore
  }
  return ids;
}

function handleAssetRemoved(assetId: string) {
  const pending = pendingAssets.value.get(assetId);
  if (pending?.kind === "audio" && pending.tempUrl.startsWith("blob:")) {
    URL.revokeObjectURL(pending.tempUrl);
  }
  pendingAssets.value.delete(assetId);
  emit("assetRemoved", assetId);
  if (pending?.kind === "image") emit("imageRemoved", assetId);
}

function insertFaqBlock() {
  editor.value
    ?.chain()
    .focus()
    .insertContent({ type: "faqBlock", attrs: { items: DEFAULT_FAQ_ITEMS } })
    .run();
}

function insertCarouselBlock() {
  editor.value
    ?.chain()
    .focus()
    .insertContent({
      type: "carouselBlock",
      attrs: { items: DEFAULT_CAROUSEL_ITEMS },
    })
    .run();
}

function insertSiteBlock(blockType: SiteBlockType) {
  editor.value
    ?.chain()
    .focus()
    .insertContent({ type: "siteBlock", attrs: { blockType } })
    .run();
}

function insertCtaButton() {
  editor.value
    ?.chain()
    .focus()
    .insertContent({
      type: "ctaButtonBlock",
      attrs: {
        text: "Learn more",
        url: "",
        style: "primary",
        icon: "",
        context: props.variant === "campaign" ? "campaign" : "site",
      },
    })
    .run();
}

function toggleBulletList() {
  editor.value?.chain().focus().toggleBulletList().run();
}

function toggleOrderedList() {
  editor.value?.chain().focus().toggleOrderedList().run();
}

function toggleTaskList() {
  editor.value?.chain().focus().toggleTaskList().run();
}

function syncActiveAssets() {
  const ids = getActiveAssetIds(editor.value);
  for (const id of lastActiveAssetIds.value) {
    if (!ids.has(id)) {
      handleAssetRemoved(id);
    }
  }
  lastActiveAssetIds.value = ids;
}

function openLinkModal() {
  linkError.value = null;
  const existing = editor.value?.getAttributes("link")?.href as
    | string
    | undefined;
  linkUrl.value = existing || "";
  showLinkModal.value = true;
}

function closeLinkModal() {
  showLinkModal.value = false;
  linkError.value = null;
  linkUrl.value = "";
}

async function openYouTubeModal() {
  youtubeError.value = null;
  youtubeUrl.value = "";
  showYouTubeModal.value = true;
  await nextTick();
  youtubeInputRef.value?.focus();
}

function closeYouTubeModal() {
  showYouTubeModal.value = false;
  youtubeError.value = null;
  youtubeUrl.value = "";
}

function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (raw.startsWith("mailto:")) return raw;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(raw)) return `https://${raw}`;
  return null;
}

function applyLink() {
  linkError.value = null;
  const normalized = normalizeUrl(linkUrl.value);
  if (!normalized) {
    linkError.value = "Please enter a valid URL (https://...) or mailto:";
    return;
  }

  editor.value
    ?.chain()
    .focus()
    .extendMarkRange("link")
    .setLink({ href: normalized })
    .run();

  closeLinkModal();
}

function applyYouTubeEmbed() {
  youtubeError.value = null;
  const normalized = normalizeYouTubeEmbedUrl(youtubeUrl.value);
  if (!normalized) {
    youtubeError.value =
      "Please enter a valid YouTube video URL or share link.";
    return;
  }

  editor.value
    ?.chain()
    .focus()
    .insertContent({
      type: "youtubeEmbed",
      attrs: { src: normalized },
    })
    .run();

  closeYouTubeModal();
}

function removeLink() {
  editor.value?.chain().focus().unsetLink().run();
  closeLinkModal();
}

function triggerImagePicker(mode: "single" | "gallery" = "single") {
  imageError.value = null;
  imageInsertMode.value = mode;
  if (imageInputRef.value) {
    imageInputRef.value.multiple = mode === "gallery";
    imageInputRef.value.click();
  }
}

function triggerAudioPicker() {
  imageError.value = null;
  audioInputRef.value?.click();
}

async function handleAudioSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const selected = input.files?.[0];
  input.value = "";
  if (!selected) return;

  const validationError = validateSiteAudioFile(selected);
  if (validationError) {
    imageError.value = validationError;
    return;
  }

  isProcessingAudio.value = true;
  try {
    const file = normalizeSiteAudioFile(selected);
    const mimeType = audioContentTypeForFile(file);
    const ext = audioExtensionForContentType(mimeType);
    const assetId = makeImageId();
    const tempUrl = URL.createObjectURL(file);
    const title =
      file.name
        .replace(/\.[a-z0-9]+$/i, "")
        .replace(/[-_]+/g, " ")
        .trim()
        .slice(0, 120) || "Audio";

    pendingAssets.value.set(assetId, {
      id: assetId,
      kind: "audio",
      blob: file,
      tempUrl,
      mimeType,
      ext,
      filename: file.name,
      title,
    });

    editor.value
      ?.chain()
      .focus()
      .insertContent({
        type: "audioBlock",
        attrs: {
          src: tempUrl,
          path: "",
          type: mimeType,
          title,
          assetId,
        },
      })
      .run();
    syncActiveAssets();
  } catch (error) {
    imageError.value =
      error instanceof Error ? error.message : "Audio could not be added.";
  } finally {
    isProcessingAudio.value = false;
  }
}

function makeImageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function extForMime(mimeType: string): string {
  switch (mimeType) {
    case "image/webp":
      return "webp";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    default:
      return "jpg";
  }
}

function ensureImageFilename(filename: string, ext: string): string {
  const cleanBase =
    filename
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "journal-image";
  return `${cleanBase}.${ext}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read image data."));
      }
    };
    reader.onerror = () => reject(reader.error || new Error("Read failed."));
    reader.readAsDataURL(blob);
  });
}

async function handleImageSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);

  input.value = "";

  if (!files.length) return;

  imageError.value = null;

  const validFiles = files.filter(
    (file) =>
      allowedImageTypes.has(file.type) &&
      (props.variant !== "campaign" || file.type !== "image/webp"),
  );
  const skippedCount = files.length - validFiles.length;

  if (validFiles.length === 0) {
    imageError.value = props.variant === "campaign"
      ? "Campaigns support JPEG, PNG, or GIF images."
      : "Please upload a JPEG, PNG, WebP, or GIF image.";
    return;
  }

  isProcessingImage.value = true;

  try {
    const imageNodes: Array<Record<string, any>> = [];

    for (const file of validFiles) {
      const prepared = await prepareImageAsset(file, file.name);

      imageNodes.push({
        type: "image",
        attrs: {
          src: prepared.dataUrl,
          alt: file.name,
          "data-image-id": prepared.id,
        },
      });
    }

    if (imageInsertMode.value === "gallery") {
      editor.value
        ?.chain()
        .focus()
        .insertContent({
          type: "gallery",
          content: imageNodes,
        } as any)
        .run();
    } else {
      for (const node of imageNodes) {
        editor.value?.chain().focus().insertContent(node as any).run();
      }
    }

    if (skippedCount > 0) {
      imageError.value = `Skipped ${skippedCount} file${
        skippedCount === 1 ? "" : "s"
      } that were not valid images.`;
    }

    syncActiveAssets();
  } catch (err) {
    console.error("Image processing error:", err);
    imageError.value =
      err instanceof Error ? err.message : "Failed to process image.";
  } finally {
    isProcessingImage.value = false;
    imageInsertMode.value = "single";
    if (imageInputRef.value) {
      imageInputRef.value.multiple = false;
    }
  }
}

// Watch for external content changes
watch(
  () => props.modelValue,
  (newContent) => {
    if (editor.value && editor.value.getHTML() !== newContent) {
      editor.value.commands.setContent(newContent);
      syncActiveAssets();
    }
  }
);

function flushPendingAssets(): PendingAsset[] {
  const queued = Array.from(pendingAssets.value.values());
  for (const asset of queued) {
    emit("assetAdded", asset);
    if (asset.kind === "image") emit("imageAdded", asset);
  }
  pendingAssets.value.clear();
  return queued;
}

function insertText(text: string) {
  const value = text.trim();
  if (!value) return;
  const activeEditor = editor.value;
  if (!activeEditor) return;

  const { from, to } = activeEditor.state.selection;
  const docSize = activeEditor.state.doc.content.size;
  const before =
    from > 0 ? activeEditor.state.doc.textBetween(from - 1, from) : "";
  const after =
    to < docSize ? activeEditor.state.doc.textBetween(to, to + 1) : "";
  const prefix = before && !/\s$/.test(before) ? " " : "";
  const suffix = after && !/^\s/.test(after) ? " " : "";

  activeEditor
    .chain()
    .focus()
    .insertContent({ type: "text", text: `${prefix}${value}${suffix}` })
    .run();
}

onBeforeUnmount(() => {
  flushPendingAssets();
  pendingAssets.value.clear();
  editor.value?.destroy();
});

// Expose editor instance for advanced usage
defineExpose({
  editor,
  getAssetIds: () => getActiveAssetIds(editor.value),
  getImageIds: () => getActiveAssetIds(editor.value),
  getPendingAssets: () => Array.from(pendingAssets.value.values()),
  getPendingImages: () => Array.from(pendingAssets.value.values()),
  flushPendingAssets,
  flushPendingImages: flushPendingAssets,
  insertText,
});
</script>

<template>
  <div
    class="tiptap-editor"
    :class="{
      'tiptap-editor--workspace': variant === 'workspace',
      'tiptap-editor--campaign': variant === 'campaign',
      'tiptap-editor--section': variant === 'section',
    }"
  >
    <!-- Toolbar -->
    <div class="editor-toolbar" @mousedown.prevent>
      <button
        type="button"
        class="toolbar-btn"
        :disabled="!editor || !editor.can().chain().focus().undo().run()"
        @click="editor?.chain().focus().undo().run()"
        title="Undo"
      >
        <UiIcon name="Undo" :size="16" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="toolbar-btn"
        :disabled="!editor || !editor.can().chain().focus().redo().run()"
        @click="editor?.chain().focus().redo().run()"
        title="Redo"
      >
        <UiIcon name="Redo" :size="16" aria-hidden="true" />
      </button>
      <span class="toolbar-divider"></span>
      <button
        type="button"
        class="toolbar-btn"
        :class="{ active: editor?.isActive('bold') }"
        @click="editor?.chain().focus().toggleBold().run()"
        title="Bold"
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        class="toolbar-btn"
        :class="{ active: editor?.isActive('italic') }"
        @click="editor?.chain().focus().toggleItalic().run()"
        title="Italic"
      >
        <em>I</em>
      </button>
      <button
        type="button"
        class="toolbar-btn"
        :class="{ active: editor?.isActive('underline') }"
        @click="editor?.chain().focus().toggleUnderline().run()"
        title="Underline"
      >
        <span class="toolbar-underline">U</span>
      </button>
      <button
        v-if="variant !== 'campaign' && !isSectionVariant"
        type="button"
        class="toolbar-btn"
        :class="{ active: editor?.isActive('strike') }"
        @click="editor?.chain().focus().toggleStrike().run()"
        title="Strikethrough"
      >
        <s>S</s>
      </button>
      <button
        v-if="variant !== 'campaign' && !isSectionVariant"
        type="button"
        class="toolbar-btn"
        :class="{ active: editor?.isActive('code') }"
        @click="editor?.chain().focus().toggleCode().run()"
        title="Inline code"
      >
        <code>{}</code>
      </button>
      <span class="toolbar-divider"></span>
      <button
        v-if="!isSectionVariant"
        type="button"
        class="toolbar-btn"
        :class="{ active: editor?.isActive('heading', { level: 1 }) }"
        @click="editor?.chain().focus().toggleHeading({ level: 1 }).run()"
        title="Heading 1"
      >
        H1
      </button>
      <button
        type="button"
        class="toolbar-btn"
        :class="{ active: editor?.isActive('heading', { level: 2 }) }"
        @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()"
        title="Heading 2"
      >
        H2
      </button>
      <button
        v-if="variant !== 'campaign' && !isSectionVariant"
        type="button"
        class="toolbar-btn"
        :class="{ active: editor?.isActive('heading', { level: 3 }) }"
        @click="editor?.chain().focus().toggleHeading({ level: 3 }).run()"
        title="Heading 3"
      >
        H3
      </button>
      <span class="toolbar-divider"></span>
      <button
        type="button"
        class="toolbar-btn"
        :class="{ active: editor?.isActive('bulletList') }"
        @click="toggleBulletList"
        title="Bullet list"
      >
        •
      </button>
      <button
        v-if="variant !== 'campaign' && !isSectionVariant"
        type="button"
        class="toolbar-btn"
        :class="{ active: editor?.isActive('orderedList') }"
        @click="toggleOrderedList"
        title="Numbered list"
      >
        1.
      </button>
      <button
        v-if="variant !== 'campaign' && !isSectionVariant"
        type="button"
        class="toolbar-btn"
        :class="{ active: editor?.isActive('taskList') }"
        @click="toggleTaskList"
        title="Task list"
        aria-label="Task list"
      >
        <UiIcon name="CircleCheckBig" :size="16" aria-hidden="true" />
      </button>
      <span v-if="variant !== 'campaign' && !isSectionVariant" class="toolbar-divider"></span>
      <button
        v-if="variant !== 'campaign' && !isSectionVariant"
        type="button"
        class="toolbar-btn"
        :class="{ active: editor?.isActive('blockquote') }"
        @click="editor?.chain().focus().toggleBlockquote().run()"
        title="Quote"
      >
        "
      </button>
      <span class="toolbar-divider"></span>
      <button
        v-if="!isSectionVariant"
        type="button"
        class="toolbar-btn"
        @click="editor?.chain().focus().setHorizontalRule().run()"
        title="Divider"
      >
        ─
      </button>
      <button
        type="button"
        class="toolbar-btn"
        :class="{ active: editor?.isActive('link') }"
        @click="openLinkModal"
        title="Link"
      >
        <UiIcon name="Link" :size="16" aria-hidden="true" />
      </button>
      <button
        v-if="variant !== 'campaign' && !isSectionVariant"
        type="button"
        class="toolbar-btn"
        :class="{ active: editor?.isActive('youtubeEmbed') }"
        @click="openYouTubeModal"
        title="Embed YouTube video"
        aria-label="Embed YouTube video"
      >
        <UiIcon name="Play" :size="16" aria-hidden="true" />
      </button>
      <button
        v-if="!isSectionVariant"
        type="button"
        class="toolbar-btn"
        :disabled="isProcessingImage"
        @click="triggerImagePicker('single')"
        title="Insert image"
      >
        <span v-if="isProcessingImage">…</span>
        <UiIcon v-else name="Image" :size="16" aria-hidden="true" />
      </button>
      <button
        v-if="variant !== 'campaign' && !isSectionVariant"
        type="button"
        class="toolbar-btn"
        :class="{ active: editor?.isActive('gallery') }"
        :disabled="isProcessingImage"
        @click="triggerImagePicker('gallery')"
        title="Insert gallery"
      >
        <UiIcon name="Images" :size="16" aria-hidden="true" />
      </button>
      <template v-if="variant === 'default'">
        <span class="toolbar-divider"></span>
        <button
          type="button"
          class="toolbar-btn"
          :class="{ active: editor?.isActive('audioBlock') }"
          :disabled="isProcessingAudio"
          @click="triggerAudioPicker"
          :title="isProcessingAudio ? 'Adding audio' : 'Insert audio'"
          :aria-label="isProcessingAudio ? 'Adding audio' : 'Insert audio'"
        >
          <span v-if="isProcessingAudio">…</span>
          <UiIcon v-else name="AudioLines" :size="16" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="toolbar-btn"
          :class="{ active: editor?.isActive('faqBlock') }"
          @click="insertFaqBlock"
          title="Insert FAQ accordion"
        >
          <UiIcon name="HelpCircle" :size="16" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="toolbar-btn"
          :class="{ active: editor?.isActive('carouselBlock') }"
          @click="insertCarouselBlock"
          title="Insert card carousel"
        >
          <UiIcon name="LayoutGrid" :size="16" aria-hidden="true" />
        </button>
      </template>
      <span v-if="variant !== 'workspace' && !isSectionVariant" class="toolbar-divider"></span>
      <button
        v-if="variant !== 'workspace' && !isSectionVariant"
        type="button"
        class="toolbar-btn"
        :class="{ active: editor?.isActive('ctaButtonBlock') }"
        @click="insertCtaButton"
        title="Insert call-to-action button"
        aria-label="Insert call-to-action button"
      >
        <UiIcon name="ExternalLink" :size="16" aria-hidden="true" />
      </button>
      <template v-if="variant === 'default'">
        <button
          type="button"
          class="toolbar-btn"
          :class="{
            active:
              editor?.isActive('siteBlock', { blockType: 'newsletter' }),
          }"
          @click="insertSiteBlock('newsletter')"
          title="Insert newsletter signup"
          aria-label="Insert newsletter signup"
        >
          <UiIcon name="Mail" :size="16" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="toolbar-btn"
          :class="{
            active:
              editor?.isActive('siteBlock', { blockType: 'testimonials' }),
          }"
          @click="insertSiteBlock('testimonials')"
          title="Insert testimonials"
          aria-label="Insert testimonials"
        >
          <UiIcon name="MessageSquare" :size="16" aria-hidden="true" />
        </button>
      </template>
    </div>

    <div v-if="showTitleField" class="editor-title-field">
      <input
        :value="title"
        type="text"
        class="editor-title-input"
        :placeholder="titlePlaceholder"
        :maxlength="titleMaxLength"
        :disabled="titleDisabled"
        aria-label="Title"
        @input="emit('update:title', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <p v-if="imageError" class="editor-error">{{ imageError }}</p>

    <!-- Editor content -->
    <div class="editor-content-wrapper">
      <EditorContent :editor="editor" />
    </div>

    <!-- Hidden file picker for images -->
    <input
      ref="imageInputRef"
      class="image-input"
      type="file"
      :multiple="imageInsertMode === 'gallery'"
      :accept="variant === 'campaign' ? 'image/jpeg,image/png,image/gif' : 'image/jpeg,image/png,image/webp,image/gif'"
      @change="handleImageSelected"
    />
    <input
      v-if="variant === 'default'"
      ref="audioInputRef"
      class="image-input"
      type="file"
      :accept="SITE_AUDIO_ACCEPT"
      @change="handleAudioSelected"
    />

    <!-- Link modal -->
    <div
      v-if="showLinkModal"
      class="link-modal-overlay editor-modal-overlay"
      @click.self="closeLinkModal"
    >
      <div
        class="link-modal editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-modal-title"
      >
        <h4 id="link-modal-title">Add link</h4>
        <input
          v-model="linkUrl"
          type="text"
          placeholder="https://example.com"
          @keyup.enter="applyLink"
          @keyup.esc="closeLinkModal"
        />
        <p v-if="linkError" class="link-error" role="alert">{{ linkError }}</p>

        <div class="link-actions">
          <button type="button" class="link-btn secondary" @click="closeLinkModal">
            Cancel
          </button>
          <button
            type="button"
            v-if="editor?.isActive('link')"
            class="link-btn danger"
            @click="removeLink"
          >
            Remove
          </button>
          <button type="button" class="link-btn primary" @click="applyLink">Save</button>
        </div>
      </div>
    </div>

    <div
      v-if="showYouTubeModal"
      class="youtube-modal-overlay editor-modal-overlay"
      @click.self="closeYouTubeModal"
    >
      <div
        class="youtube-modal editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="youtube-modal-title"
      >
        <h4 id="youtube-modal-title">Embed YouTube video</h4>
        <label class="editor-modal-label" for="youtube-url-input">
          Paste a YouTube URL
        </label>
        <input
          id="youtube-url-input"
          ref="youtubeInputRef"
          v-model="youtubeUrl"
          type="text"
          placeholder="https://youtu.be/..."
          @keyup.enter="applyYouTubeEmbed"
          @keyup.esc="closeYouTubeModal"
        />
        <p v-if="youtubeError" class="link-error" role="alert">
          {{ youtubeError }}
        </p>

        <div class="link-actions">
          <button type="button" class="link-btn secondary" @click="closeYouTubeModal">
            Cancel
          </button>
          <button type="button" class="link-btn primary" @click="applyYouTubeEmbed">
            Insert
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tiptap-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px;
  position: sticky;
  top: var(--tiptap-toolbar-offset, 12px);
  z-index: 20;
  color: var(--color-text, #232428);
  background: var(--color-bg-subtle, #ffffff);
  border-radius: 8px;
  flex-wrap: wrap;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: inherit;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition:
    background 0.2s,
    color 0.2s;
}

.toolbar-btn:hover {
  background: var(--color-bg-muted, #eef1f0);
}

.toolbar-btn.active {
  background: var(--color-primary, #007bff);
  color: white;
}

.toolbar-underline {
  text-decoration: underline;
}

.toolbar-btn code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
}

.toolbar-btn:disabled {
  opacity: 0.5;
  color: var(--color-text-muted, #5d6368);
  cursor: not-allowed;
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  background: var(--color-border, #ddd);
  margin: 0 4px;
}

.editor-error {
  color: #dc3545;
  font-size: 14px;
  margin: 0;
}

.editor-content-wrapper {
  border: 1px solid var(--color-border, #ddd);
  border-radius: 8px;
  padding: 16px;
  min-height: 200px;
}

.editor-content-wrapper :deep(.ProseMirror) {
  outline: none;
  min-height: 200px;
}

.editor-content-wrapper :deep(.ProseMirror ul),
.editor-content-wrapper :deep(.ProseMirror ol) {
  margin: 0.75em 0;
  padding-left: 1.5em;
}

.editor-content-wrapper :deep(.ProseMirror ul) {
  list-style-type: disc;
}

.editor-content-wrapper :deep(.ProseMirror ul ul) {
  list-style-type: circle;
}

.editor-content-wrapper :deep(.ProseMirror ol) {
  list-style-type: decimal;
}

.editor-content-wrapper :deep(.ProseMirror li) {
  margin: 0.25em 0;
  padding-left: 0.15em;
}

.editor-content-wrapper :deep(.ProseMirror li > p) {
  margin: 0;
}

.editor-content-wrapper :deep(.ProseMirror ul[data-type="taskList"]),
.editor-content-wrapper :deep(.ProseMirror ul.tiptap-task-list) {
  list-style: none;
  padding-left: 0;
}

.editor-content-wrapper
  :deep(.ProseMirror ul[data-type="taskList"] ul[data-type="taskList"]),
.editor-content-wrapper
  :deep(.ProseMirror ul.tiptap-task-list ul.tiptap-task-list) {
  margin: 0.25em 0 0.25em 1.5em;
}

.editor-content-wrapper :deep(.ProseMirror li[data-type="taskItem"]),
.editor-content-wrapper :deep(.ProseMirror li.tiptap-task-item) {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding-left: 0;
}

.editor-content-wrapper :deep(.ProseMirror li[data-type="taskItem"] > label),
.editor-content-wrapper :deep(.ProseMirror li.tiptap-task-item > label) {
  flex: 0 0 auto;
  margin-top: 0.15em;
  user-select: none;
}

.editor-content-wrapper :deep(.ProseMirror li[data-type="taskItem"] > div),
.editor-content-wrapper :deep(.ProseMirror li.tiptap-task-item > div) {
  flex: 1 1 auto;
  min-width: 0;
}

.editor-content-wrapper
  :deep(.ProseMirror li[data-type="taskItem"] input[type="checkbox"]),
.editor-content-wrapper
  :deep(.ProseMirror li.tiptap-task-item input[type="checkbox"]) {
  width: 16px;
  height: 16px;
  accent-color: var(--ui-accent, var(--color-primary, #007bff));
  cursor: pointer;
}

.editor-content-wrapper :deep(.ProseMirror blockquote) {
  margin: 1em 0;
  padding: 0.1em 0 0.1em 1em;
  border-left: 3px solid var(--ui-border-strong, var(--color-border, #ddd));
  color: var(--ui-text-muted, var(--color-text-muted, #5d6368));
}

.editor-content-wrapper :deep(.ProseMirror hr.tiptap-divider) {
  margin: 1.5em 0;
  border: 0;
  border-top: 1px solid
    var(--ui-border-strong, var(--color-border, #d5d8d7));
}

.editor-content-wrapper :deep(.ProseMirror) img {
  max-width: 100%;
}

.editor-content-wrapper :deep(.tiptap-gallery) {
  display: block;
  column-count: 2;
  column-gap: 12px;
}

.editor-content-wrapper :deep(.tiptap-gallery .tiptap-image) {
  break-inside: avoid;
  margin-bottom: 12px;
}

.editor-content-wrapper :deep(.tiptap-gallery .image-shell) {
  width: 100% !important;
}

.editor-content-wrapper :deep(.tiptap-gallery .image) {
  width: 100%;
  height: auto;
}

.editor-content-wrapper :deep(.tiptap-gallery .image-caption-input) {
  margin-top: 6px;
  font-size: 12px;
}

.editor-content-wrapper :deep(.tiptap-youtube) {
  margin: 16px 0;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid var(--color-border, #ddd);
  background: var(--color-bg-subtle, #fff);
}

.editor-content-wrapper :deep(.tiptap-youtube iframe) {
  width: 100%;
  aspect-ratio: 16 / 9;
  border: none;
  display: block;
}

@media (max-width: 720px) {
  .editor-content-wrapper :deep(.tiptap-gallery) {
    column-count: 2;
  }
}

@media (max-width: 520px) {
  .editor-content-wrapper :deep(.tiptap-gallery) {
    column-count: 1;
  }
}

.editor-content-wrapper
  :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: var(--color-text-muted, #999);
  pointer-events: none;
  height: 0;
}

.image-input {
  display: none;
}

.editor-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.editor-modal {
  padding: 24px;
  min-width: 320px;
  max-width: 90vw;
  border: 1px solid var(--ui-border, var(--color-border, #ddd));
  border-radius: var(--ui-radius-lg, 12px);
  background: var(--ui-surface, var(--color-bg, #ffffff));
  color: var(--ui-text, var(--color-text, #232428));
  box-shadow: var(--ui-shadow-md, 0 18px 42px rgba(0, 0, 0, 0.18));
}

.editor-modal h4 {
  margin: 0 0 16px 0;
  font-size: 18px;
}

.editor-modal-label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-text, var(--color-text, #232428));
}

.editor-modal input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--ui-border, var(--color-border, #ddd));
  border-radius: var(--ui-radius-sm, 6px);
  background: var(--ui-surface, var(--color-bg, #ffffff));
  color: var(--ui-text, var(--color-text, #232428));
  font-size: 14px;
  margin-bottom: 8px;
}

.editor-modal input::placeholder {
  color: var(--ui-text-muted, var(--color-text-muted, #5d6368));
}

.editor-modal input:focus {
  border-color: var(--ui-accent, var(--color-accent, #007bff));
  outline: none;
}

.link-error {
  color: var(--ui-danger, #dc3545);
  font-size: 13px;
  margin: 0 0 12px 0;
}

.link-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.link-btn {
  padding: 8px 16px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm, 6px);
  cursor: pointer;
  font-size: 14px;
  transition:
    background 0.2s,
    border-color 0.2s,
    color 0.2s;
}

.link-btn.secondary {
  border-color: var(--ui-border, var(--color-border, #ddd));
  background: var(--ui-surface-muted, var(--color-bg-subtle, #f5f5f5));
  color: var(--ui-text, var(--color-text, #232428));
}

.link-btn.secondary:hover {
  border-color: var(--ui-border-strong, var(--color-border-strong, #cfcfcf));
  background: var(--ui-bg, var(--color-bg-muted, #e8e8e8));
}

.link-btn.danger {
  border-color: color-mix(
    in oklab,
    var(--ui-danger, #dc3545) 42%,
    var(--ui-border, var(--color-border, #ddd))
  );
  background: color-mix(
    in oklab,
    var(--ui-danger, #dc3545) 12%,
    var(--ui-surface, var(--color-bg, #ffffff))
  );
  color: var(--ui-danger, #dc3545);
}

.link-btn.danger:hover {
  background: var(--ui-danger, #dc3545);
  color: #ffffff;
}

.link-btn.primary {
  background: var(--ui-accent, var(--color-accent, #007bff));
  color: var(--ui-accent-contrast, var(--color-accent-contrast, #ffffff));
}

.link-btn.primary:hover {
  background: var(--ui-accent-strong, #0056b3);
}

.editor-title-field {
  width: 100%;
}

.editor-title-input {
  width: 100%;
  box-sizing: border-box;
  border: 0;
  border-bottom: 1px solid transparent;
  padding: 4px 0 8px;
  background: transparent;
  color: var(--ui-text, var(--color-text, #232428));
  font: inherit;
  outline: none;
}

.editor-title-input:focus {
  border-bottom-color: var(--ui-accent, var(--color-accent, #007bff));
}

.editor-title-input:disabled {
  opacity: 0.58;
  cursor: not-allowed;
}

.tiptap-editor--workspace .editor-title-input {
  font-size: clamp(1.25rem, 2.5vw, 1.5rem);
  font-weight: 600;
  line-height: 1.25;
}

.tiptap-editor--workspace {
  gap: 4px;
}

.tiptap-editor--workspace .editor-toolbar {
  box-sizing: border-box;
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  border: none;
  border-radius: 0;
  background: var(--ui-bg, var(--color-bg, #ffffff));
  flex-wrap: wrap;
  justify-content: center;
  row-gap: 4px;
}

@media (max-width: 720px) {
  .tiptap-editor--workspace .editor-toolbar {
    flex-wrap: nowrap;
    justify-content: flex-start;
    overflow-x: auto;
    row-gap: 0;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .tiptap-editor--workspace .editor-toolbar::-webkit-scrollbar {
    display: none;
  }

  .tiptap-editor--workspace .toolbar-btn,
  .tiptap-editor--workspace .toolbar-divider {
    flex: 0 0 auto;
  }
}

.tiptap-editor--workspace .editor-content-wrapper {
  border: none;
  border-radius: 0;
  padding-left: 0;
  padding-right: 0;
}
</style>
