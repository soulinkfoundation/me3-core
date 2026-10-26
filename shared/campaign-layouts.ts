import type {
  CampaignBlock,
  CampaignDocumentV1,
  CampaignTextParagraph,
  CampaignTextSpan,
} from "./campaign-document";

/**
 * Starting layouts for a new campaign (me3-bli3.2.12). Built only from existing block types, plus a
 * photo slot the editor shows and drops when the email is saved. Starter text tells the owner what
 * goes there, and sending is blocked until it is replaced.
 */

export const CAMPAIGN_LAYOUT_IDS = ["newsletter", "news", "event"] as const;
export type CampaignLayoutId = (typeof CAMPAIGN_LAYOUT_IDS)[number];

export type CampaignPhotoSlot = { id: string; type: "photo-slot" };
export type CampaignLayoutBlock = CampaignBlock | CampaignPhotoSlot;

export type CampaignLayout = {
  id: CampaignLayoutId;
  name: string;
  description: string;
  subject: string;
  blocks: CampaignLayoutBlock[];
};

export type CampaignLayoutContext = {
  businessName: string;
  homeUrl: string;
  /** Month name filled into the Newsletter, e.g. "October". */
  month: string;
};

const STARTER = {
  hello: "Say hello and sum up this month in a line.",
  firstStory: "Your first story",
  storyBody: "A few sentences about it. Add a link if there's more to read.",
  secondStory: "Your second story",
  secondBody: "Keep each story short. Most people read on their phone.",
  happening: "What's happening",
  newsHeading: "Your news in a few words",
  newsWhat: "What's new, and when does it start?",
  newsDetail: "One more detail people need to know.",
  eventName: "Name of the event or offer",
  eventWhy: "One or two lines on why it's worth coming.",
  when: "Date and time",
  where: "Place or link",
  price: "Cost, or Free",
  deadline: "Any deadline, like when the early price ends.",
  signOff: "Sign off with your name",
} as const;

export const CAMPAIGN_STARTER_STRINGS: readonly string[] = Object.values(STARTER);

const STARTER_SET = new Set(CAMPAIGN_STARTER_STRINGS);

export function campaignLayouts(context: CampaignLayoutContext): CampaignLayout[] {
  return CAMPAIGN_LAYOUT_IDS.map((id) => campaignLayout(id, context));
}

export function campaignLayout(id: CampaignLayoutId, context: CampaignLayoutContext): CampaignLayout {
  const name = context.businessName.trim() || "us";
  if (id === "newsletter") {
    const heading = `${context.month} at ${name}`;
    return {
      id,
      name: "Newsletter",
      description: "A hello, a few short stories, dates",
      subject: heading,
      blocks: [
        text("newsletter-intro", [heading1(heading), body(STARTER.hello)]),
        photoSlot("newsletter-photo"),
        text("newsletter-story-1", [heading2(STARTER.firstStory), body(STARTER.storyBody)]),
        { id: "newsletter-line-1", type: "divider" },
        text("newsletter-story-2", [heading2(STARTER.secondStory), body(STARTER.secondBody)]),
        { id: "newsletter-line-2", type: "divider" },
        text("newsletter-dates", [
          heading2("Dates for your diary"),
          labelled("Date", STARTER.happening),
          labelled("Date", STARTER.happening),
          body(STARTER.signOff),
        ]),
      ],
    };
  }
  if (id === "news") {
    return {
      id,
      name: "News",
      description: "One announcement and a button",
      subject: `News from ${name}`,
      blocks: [
        photoSlot("news-photo"),
        text("news-copy", [heading1(STARTER.newsHeading), body(STARTER.newsWhat), body(STARTER.newsDetail)]),
        button("news-button", "Book now", context.homeUrl),
        text("news-sign-off", [body(STARTER.signOff)]),
      ],
    };
  }
  return {
    id,
    name: "Event or offer",
    description: "When, where, price and a button",
    subject: `Coming up at ${name}`,
    blocks: [
      text("event-intro", [heading1(STARTER.eventName), body(STARTER.eventWhy)]),
      photoSlot("event-photo"),
      text("event-details", [
        labelled("When", STARTER.when),
        labelled("Where", STARTER.where),
        labelled("Price", STARTER.price),
      ]),
      button("event-button", "Book your spot", context.homeUrl),
      text("event-close", [
        { style: "body", spans: [{ text: STARTER.deadline, marks: ["italic"] }] },
        body(STARTER.signOff),
      ]),
    ],
  };
}

export function isCampaignLayoutId(value: unknown): value is CampaignLayoutId {
  return typeof value === "string" && (CAMPAIGN_LAYOUT_IDS as readonly string[]).includes(value);
}

/** The layout as a saveable document body: photo slots are left out. */
export function campaignLayoutDocumentBlocks(blocks: CampaignLayoutBlock[]): CampaignBlock[] {
  return blocks.filter((block): block is CampaignBlock => block.type !== "photo-slot");
}

/**
 * Starter strings still in the email, in reading order and without repeats. A paragraph counts when
 * it, or one of its "Label · value" parts, is exactly a starter string, so real copy that happens to
 * contain the same words never blocks a send.
 */
export function findCampaignStarterText(document: Pick<CampaignDocumentV1, "blocks">): string[] {
  const found: string[] = [];
  const check = (value: string) => {
    for (const part of [value, ...value.split("·")]) {
      const trimmed = part.trim();
      if (STARTER_SET.has(trimmed) && !found.includes(trimmed)) found.push(trimmed);
    }
  };
  for (const block of document.blocks) {
    if (block.type === "text") {
      for (const paragraph of block.paragraphs) check(paragraph.spans.map((span) => span.text).join(""));
    } else if (block.type === "button") {
      check(block.label);
    }
  }
  return found;
}

function text(id: string, paragraphs: CampaignTextParagraph[]): CampaignBlock {
  return { id, type: "text", paragraphs };
}

function photoSlot(id: string): CampaignPhotoSlot {
  return { id, type: "photo-slot" };
}

function button(id: string, label: string, href: string): CampaignBlock {
  return { id, type: "button", label, href, alignment: "center" };
}

function heading1(value: string): CampaignTextParagraph {
  return { style: "heading1", spans: [{ text: value }] };
}

function heading2(value: string): CampaignTextParagraph {
  return { style: "heading2", spans: [{ text: value }] };
}

function body(value: string): CampaignTextParagraph {
  return { style: "body", spans: [{ text: value }] };
}

function labelled(label: string, value: string): CampaignTextParagraph {
  const spans: CampaignTextSpan[] = [{ text: label, marks: ["bold"] }, { text: ` · ${value}` }];
  return { style: "bullet", spans };
}
