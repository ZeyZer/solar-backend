const assert = require("assert");

const {
  upsertBrevoContact,
  sendQuoteEmailWithAttachment,
  sendCallbackNotification,
} = require("./services/integrations/brevoService");

const {
  getBrevoConfigForLeadOwner,
} = require("./config/leadOwnerConfig");

async function main() {
  await assert.rejects(
    () =>
      upsertBrevoContact(
        { email: "test@example.com" },
        {
          brevoConfig: {
            leadOwner: "zion-energy",
          },
          baseListId: 6,
        }
      ),
    /Brevo API key is not configured/
  );

  await assert.rejects(
    () =>
      upsertBrevoContact(
        { email: "test@example.com" },
        {
          brevoConfig: {
            leadOwner: "zion-energy",
            apiKey: "test-key",
          },
        }
      ),
    /Brevo contact list is not configured/
  );

  await assert.rejects(
    () =>
      sendQuoteEmailWithAttachment(
        { email: "test@example.com" },
        {},
        {},
        Buffer.from("test-pdf"),
        undefined,
        {
          leadOwner: "zion-energy",
          apiKey: "test-key",
        }
      ),
    /Brevo quote email template is not configured/
  );

  await assert.rejects(
    () =>
      sendQuoteEmailWithAttachment(
        { email: "test@example.com" },
        {},
        {},
        null,
        2,
        {
          leadOwner: "zion-energy",
          apiKey: "test-key",
        }
      ),
    /requires a PDF attachment/
  );

  const callbackResult = await sendCallbackNotification({
    contact: {
      name: "Test Customer",
      email: "test@example.com",
      phone: "07123456789",
    },
    quote: {},
    input: {},
    leadId: "lead_test",
    routing: {
      source: "zion-website",
      leadOwner: "zion-energy",
    },
    brevoConfig: {
      leadOwner: "zion-energy",
      apiKey: "test-key",
    },
  });

  assert.deepStrictEqual(callbackResult, {
    skipped: true,
    reason: "Callback notification email/template is not configured.",
  });

  process.env.ZION_BREVO_CALLBACK_NOTIFY_EMAIL = "callbacks@example.com";
  process.env.ZION_BREVO_TEMPLATE_ID_CALLBACK_NOTIFY = "321";

  process.env.BREVO_API_KEY = "zeyzer-test-key";
  process.env.BREVO_TEMPLATE_ID_QUOTE = "101";
  process.env.BREVO_TEMPLATE_ID_CALL = "102";
  process.env.BREVO_QUOTE_LIST_ID = "103";
  process.env.BREVO_CALL_LIST_ID = "104";
  process.env.BREVO_MARKETING_LIST_ID = "105";

  const originalZionApiKey = process.env.ZION_BREVO_API_KEY;

  delete process.env.ZION_BREVO_API_KEY;

  const zionWithoutOwnKey =
    getBrevoConfigForLeadOwner("zion-energy");

  assert.strictEqual(
    zionWithoutOwnKey.apiKey,
    "",
    "Zion must not fall back to the generic ZeyZer Brevo API key."
  );

  if (originalZionApiKey === undefined) {
    delete process.env.ZION_BREVO_API_KEY;
  } else {
    process.env.ZION_BREVO_API_KEY = originalZionApiKey;
  }

  const routedConfig = getBrevoConfigForLeadOwner("zion-energy");

  assert.strictEqual(
    routedConfig.callbackNotifyEmail,
    "callbacks@example.com"
  );
  assert.strictEqual(
    routedConfig.callbackNotifyTemplateId,
    321
  );

  const zeyzerConfig = getBrevoConfigForLeadOwner("zeyzer");

  assert.strictEqual(zeyzerConfig.leadOwner, "zeyzer");
  assert.strictEqual(zeyzerConfig.apiKey, "zeyzer-test-key");
  assert.strictEqual(zeyzerConfig.quoteTemplateId, 101);
  assert.strictEqual(zeyzerConfig.callTemplateId, 102);
  assert.strictEqual(zeyzerConfig.quoteListId, 103);
  assert.strictEqual(zeyzerConfig.callListId, 104);
  assert.strictEqual(zeyzerConfig.marketingListId, 105);

  assert.notStrictEqual(
    zeyzerConfig.apiKey,
    routedConfig.apiKey,
    "ZeyZer and Zion must resolve separate Brevo credentials."
  );

  console.log("Lead action reliability tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
