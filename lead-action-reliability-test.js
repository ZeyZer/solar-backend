const assert = require("assert");

const {
  upsertBrevoContact,
  sendQuoteEmailWithAttachment,
  sendCallbackNotification,
  isDuplicateParameterError,
  isSmsDuplicateError,
  withoutSmsAttribute,
} = require("./services/integrations/brevoService");

const {
  getBrevoConfigForLeadOwner,
} = require("./config/leadOwnerConfig");

const {
  createEmailQuoteHandler,
  createRequestCallHandler,
} = require("./routes/leadRoutes");

function createResponse(timeline = []) {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      timeline.push("response");
      return this;
    },
  };
}

function createRouting() {
  return {
    tenantId: "zion-energy",
    source: "zion-website",
    leadOwner: "zion-energy",
    integration: {
      brevo: {
        leadOwner: "zion-energy",
        apiKey: "test-key",
        quoteListId: 10,
        callListId: 11,
        quoteTemplateId: 12,
        callTemplateId: 13,
        callbackNotifyEmail: "callbacks@example.com",
        callbackNotifyTemplateId: 14,
      },
    },
  };
}

function createLeadRequestBody() {
  return {
    leadId: "lead_test",
    contact: {
      name: "Test Customer",
      email: "test@example.com",
      phone: "07123456789",
      address: "10 Test Street, London",
    },
    quote: {
      leadId: "lead_test",
      panelCount: 10,
      systemSizeKwp: 4.65,
      marker: "current-quote",
    },
    input: {
      postcode: "SW1A 1AA",
      batteryKWh: 5,
      roofs: [{ id: "roof-1", panels: 10 }],
      marker: "current-input",
    },
    marketingConsent: true,
  };
}

async function testEmailQuoteRouteReliability() {
  const validationResponse = createResponse();
  await createEmailQuoteHandler()(
    { body: {} },
    validationResponse
  );
  assert.strictEqual(validationResponse.statusCode, 400);

  for (const failureStage of ["routing", "upsert"]) {
    const response = createResponse();
    const handler = createEmailQuoteHandler({
      resolveRouting: async () => {
        if (failureStage === "routing") throw new Error("routing failed");
        return createRouting();
      },
      upsertContact: async () => {
        if (failureStage === "upsert") throw new Error("upsert failed");
      },
    });

    await handler({ body: createLeadRequestBody() }, response);
    assert.strictEqual(response.statusCode, 500);
  }

  const schedulerFailureTimeline = [];
  let schedulerFailurePdfStarted = false;
  const schedulerFailureResponse = createResponse(
    schedulerFailureTimeline
  );
  const schedulerFailureHandler = createEmailQuoteHandler({
    resolveRouting: async () => createRouting(),
    upsertContact: async () => {},
    generatePdf: async () => {
      schedulerFailurePdfStarted = true;
      return Buffer.from("pdf");
    },
    recordEvent: async () => {},
    scheduleBackground: () => {
      throw new Error("scheduler failed");
    },
  });

  await schedulerFailureHandler(
    { body: createLeadRequestBody() },
    schedulerFailureResponse
  );
  assert.strictEqual(schedulerFailureResponse.statusCode, 500);
  assert.deepStrictEqual(schedulerFailureTimeline, ["response"]);
  assert.strictEqual(schedulerFailurePdfStarted, false);

  const timeline = [];
  const events = [];
  const backgroundTasks = [];
  let generatedPdfArgs;
  let sentEmailArgs;
  const body = createLeadRequestBody();

  const handler = createEmailQuoteHandler({
    resolveRouting: async () => createRouting(),
    upsertContact: async () => timeline.push("upsert"),
    generatePdf: async (args) => {
      timeline.push("pdf");
      generatedPdfArgs = args;
      return Buffer.from("pdf");
    },
    sendQuoteEmail: async (...args) => {
      timeline.push("email");
      sentEmailArgs = args;
    },
    recordEvent: async (event) => {
      timeline.push(event.eventType);
      events.push(event);
    },
    scheduleBackground: (task) => {
      timeline.push("scheduled");
      backgroundTasks.push(task);
    },
  });

  const response = createResponse(timeline);
  await handler({ body }, response);

  assert.strictEqual(response.statusCode, 202);
  assert.deepStrictEqual(response.body, {
    ok: true,
    accepted: true,
    leadId: "lead_test",
  });
  assert.deepStrictEqual(timeline, [
    "upsert",
    "pdf_email_requested",
    "scheduled",
    "response",
  ]);
  assert.strictEqual(backgroundTasks.length, 1);

  body.quote.marker = "mutated-quote";
  body.input.marker = "mutated-input";
  body.input.roofs[0].panels = 99;
  await backgroundTasks[0]();

  assert.strictEqual(generatedPdfArgs.quote.marker, "current-quote");
  assert.strictEqual(generatedPdfArgs.form.marker, "current-input");
  assert.strictEqual(generatedPdfArgs.roofs[0].panels, 10);
  assert.strictEqual(sentEmailArgs[1].marker, "current-quote");
  assert.strictEqual(sentEmailArgs[2].marker, "current-input");
  assert.deepStrictEqual(events.map((event) => event.eventType), [
    "pdf_email_requested",
    "pdf_email_sent",
  ]);
  assert.strictEqual(events[0].metadata.marketingConsent, undefined);
  assert.strictEqual(events[1].metadata.email, undefined);

  for (const failureStage of ["pdf", "email"]) {
    const failureEvents = [];
    const tasks = [];
    const failureHandler = createEmailQuoteHandler({
      resolveRouting: async () => createRouting(),
      upsertContact: async () => {},
      generatePdf: async () => {
        if (failureStage === "pdf") throw new Error("pdf failed");
        return Buffer.from("pdf");
      },
      sendQuoteEmail: async () => {
        if (failureStage === "email") throw new Error("email failed");
      },
      recordEvent: async (event) => failureEvents.push(event.eventType),
      scheduleBackground: (task) => tasks.push(task),
    });
    const failureResponse = createResponse();

    await failureHandler(
      { body: createLeadRequestBody() },
      failureResponse
    );
    assert.strictEqual(failureResponse.statusCode, 202);
    await assert.doesNotReject(tasks[0]());
    assert.deepStrictEqual(failureEvents, [
      "pdf_email_requested",
      "pdf_email_failed",
    ]);
  }
}

async function testRequestCallRouteReliability() {
  const validationResponse = createResponse();
  await createRequestCallHandler()(
    { body: {} },
    validationResponse
  );
  assert.strictEqual(validationResponse.statusCode, 400);

  for (const failureStage of ["routing", "upsert", "callback"]) {
    const response = createResponse();
    const handler = createRequestCallHandler({
      resolveRouting: async () => {
        if (failureStage === "routing") throw new Error("routing failed");
        return createRouting();
      },
      upsertContact: async () => {
        if (failureStage === "upsert") throw new Error("upsert failed");
      },
      sendCallback: async () => {
        if (failureStage === "callback") throw new Error("callback failed");
        return { skipped: false };
      },
    });

    await handler({ body: createLeadRequestBody() }, response);
    assert.strictEqual(response.statusCode, 500);
  }

  const skippedResponse = createResponse();
  await createRequestCallHandler({
    resolveRouting: async () => createRouting(),
    upsertContact: async () => {},
    sendCallback: async () => ({ skipped: true }),
  })({ body: createLeadRequestBody() }, skippedResponse);
  assert.strictEqual(skippedResponse.statusCode, 500);

  const timeline = [];
  const events = [];
  const tasks = [];
  let generatedPdfArgs;
  let sentEmailArgs;
  const body = createLeadRequestBody();
  const handler = createRequestCallHandler({
    resolveRouting: async () => createRouting(),
    upsertContact: async () => timeline.push("upsert"),
    sendCallback: async () => {
      timeline.push("callback");
      return { skipped: false };
    },
    generatePdf: async (args) => {
      timeline.push("pdf");
      generatedPdfArgs = args;
      return Buffer.from("pdf");
    },
    sendQuoteEmail: async (...args) => {
      timeline.push("email");
      sentEmailArgs = args;
    },
    recordEvent: async (event) => {
      timeline.push(event.eventType);
      events.push(event);
    },
    scheduleBackground: (task) => {
      timeline.push("scheduled");
      tasks.push(task);
    },
  });
  const response = createResponse(timeline);

  await handler({ body }, response);
  assert.strictEqual(response.statusCode, 202);
  assert.deepStrictEqual(timeline, [
    "upsert",
    "callback",
    "call_requested",
    "scheduled",
    "response",
  ]);

  body.quote.marker = "mutated-quote";
  body.input.marker = "mutated-input";
  body.input.roofs[0].panels = 99;
  await tasks[0]();

  assert.strictEqual(generatedPdfArgs.quote.marker, "current-quote");
  assert.strictEqual(generatedPdfArgs.form.marker, "current-input");
  assert.strictEqual(generatedPdfArgs.roofs[0].panels, 10);
  assert.strictEqual(sentEmailArgs[1].marker, "current-quote");
  assert.strictEqual(sentEmailArgs[2].marker, "current-input");
  assert.deepStrictEqual(events.map((event) => event.eventType), [
    "call_requested",
    "pdf_email_sent",
  ]);

  for (const failureStage of ["pdf", "email"]) {
    const failureEvents = [];
    const failureTasks = [];
    const failureHandler = createRequestCallHandler({
      resolveRouting: async () => createRouting(),
      upsertContact: async () => {},
      sendCallback: async () => ({ skipped: false }),
      generatePdf: async () => {
        if (failureStage === "pdf") throw new Error("pdf failed");
        return Buffer.from("pdf");
      },
      sendQuoteEmail: async () => {
        if (failureStage === "email") throw new Error("email failed");
      },
      recordEvent: async (event) => failureEvents.push(event.eventType),
      scheduleBackground: (task) => failureTasks.push(task),
    });
    const failureResponse = createResponse();

    await failureHandler(
      { body: createLeadRequestBody() },
      failureResponse
    );
    assert.strictEqual(failureResponse.statusCode, 202);
    await assert.doesNotReject(failureTasks[0]());
    assert.deepStrictEqual(failureEvents, [
      "call_requested",
      "pdf_email_failed",
    ]);
  }
}

async function main() {
  const smsDuplicateError = {
    response: {
      body: {
        code: "duplicate_parameter",
        message:
          "Unable to update contact, SMS is already associated with another Contact",
        metadata: {
          duplicate_identifiers: ["SMS"],
        },
      },
    },
  };

  assert.strictEqual(
    isDuplicateParameterError(smsDuplicateError),
    true
  );
  assert.strictEqual(
    isSmsDuplicateError(smsDuplicateError),
    true
  );

  const emailDuplicateError = {
    response: {
      body: {
        code: "duplicate_parameter",
        message: "Contact already exist",
        metadata: {
          duplicate_identifiers: ["email"],
        },
      },
    },
  };

  assert.strictEqual(
    isDuplicateParameterError(emailDuplicateError),
    true
  );
  assert.strictEqual(
    isSmsDuplicateError(emailDuplicateError),
    false
  );

  assert.deepStrictEqual(
    withoutSmsAttribute({
      FIRSTNAME: "Test Customer",
      SMS: "+447123456789",
      LEAD_TYPE: "request_call",
    }),
    {
      FIRSTNAME: "Test Customer",
      LEAD_TYPE: "request_call",
    }
  );

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

  await testEmailQuoteRouteReliability();
  await testRequestCallRouteReliability();

  console.log("Lead action reliability tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
