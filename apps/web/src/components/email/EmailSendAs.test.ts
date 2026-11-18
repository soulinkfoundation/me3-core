import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Failure modes: the send-as form and a provider connect form show to owners who never
 * asked for another address; the provider picker shows when there is only one choice.
 */
const apiGet = vi.fn();

vi.mock("../../api", () => ({
  api: { get: (...args: unknown[]) => apiGet(...args), post: vi.fn(), delete: vi.fn() },
}));
vi.mock("../../composables/useAppToast", () => ({
  useAppToast: () => ({ toastSuccess: vi.fn(), toastFromUnknown: vi.fn() }),
}));

import EmailSendAs from "./EmailSendAs.vue";

function respond(configured: string[]) {
  apiGet.mockImplementation((path: string) =>
    Promise.resolve(
      path === "/email-provider-settings"
        ? { providers: configured.map((id) => ({ id, label: id, configured: true })) }
        : { identities: [] },
    ),
  );
}

async function mountSendAs() {
  const wrapper = mount(EmailSendAs, { global: { stubs: { CampaignSenderSetup: true } } });
  await flushPromises();
  return wrapper;
}

function addButton(wrapper: Awaited<ReturnType<typeof mountSendAs>>) {
  return wrapper.findAll("button").find((button) => button.text() === "Add address");
}

describe("EmailSendAs", () => {
  beforeEach(() => apiGet.mockReset());

  it("keeps the form and connect step closed until the owner adds an address", async () => {
    respond([]);
    const wrapper = await mountSendAs();

    expect(wrapper.find("form").exists()).toBe(false);
    expect(wrapper.find("campaign-sender-setup-stub").exists()).toBe(false);

    await addButton(wrapper)!.trigger("click");
    expect(wrapper.find("form").exists()).toBe(true);
    expect(wrapper.find("campaign-sender-setup-stub").exists()).toBe(false);

    await wrapper.find('input[type="email"]').setValue("me@work.com");
    expect(wrapper.find("campaign-sender-setup-stub").exists()).toBe(true);
  });

  it("skips the provider picker when exactly one provider is connected", async () => {
    respond(["postmark"]);
    const wrapper = await mountSendAs();
    await addButton(wrapper)!.trigger("click");

    expect(wrapper.find("select").exists()).toBe(false);
    expect(wrapper.text()).toContain("Send code");
  });
});
