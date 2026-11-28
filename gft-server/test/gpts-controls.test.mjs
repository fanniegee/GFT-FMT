import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import sharp from "sharp";
import { createGptsCustomers } from "../src/gpts-customers.js";
import { installGptsPayments } from "../src/gpts-payments.js";
import { createGptsPaymentEngine } from "../src/gpts-payment-engine.js";
import { installGptsPaymentOperations } from "../src/gpts-payment-operations.js";
import {
  createVault,
  base32,
  totp,
  digest,
  minor,
} from "../src/gpts-money-security.js";

test("encryption, exact money and authenticator test vectors", () => {
  const key = randomBytes(32).toString("base64"),
    vault = createVault({ key }),
    sealed = vault.seal({ account: "private account" }, "recipient:one");
  assert.ok(!sealed.includes(Buffer.from("private account")));
  assert.deepEqual(vault.open(sealed, "recipient:one"), {
    account: "private account",
  });
  assert.throws(() => vault.open(sealed, "recipient:another"));
  const tampered = Buffer.from(sealed);
  tampered[tampered.length - 5] ^= 1;
  assert.throws(() => vault.open(tampered, "recipient:one"));
  const rotated = createVault({
    key: randomBytes(32).toString("base64"),
    keyId: "v2",
    oldKeys: JSON.stringify({ v1: key }),
  });
  assert.deepEqual(rotated.open(sealed, "recipient:one"), {
    account: "private account",
  });
  assert.equal(createVault({ key: "" }).configured(), false);
  assert.throws(() => createVault({ key: "" }).seal("sensitive", "context"));
  assert.equal(totp(base32(Buffer.from("12345678901234567890")), 1), "287082");
  assert.equal(minor("9999999999999999.99"), 999999999999999999n);
  assert.throws(() => minor("1e3"));
  assert.throws(() => minor("0"));
  assert.throws(() => minor("-1"));
});

test("payments workflow against isolated PostgreSQL with real constraints and rollback", async (t) => {
  const db = new PGlite();
  const run = async (connection, sql, args = []) =>
    args.length
      ? connection.query(sql, args)
      : (await connection.exec(sql)).at(-1) || { rows: [] };
  const query = (sql, args) => run(db, sql, args),
    withTransaction = (callback) =>
      db.transaction((connection) =>
        callback({ query: (sql, args) => run(connection, sql, args) }),
      );
  const accounts = createGptsCustomers({ query, withTransaction });
  const foundation = installGptsPayments(express(), {
    query,
    withTransaction,
    ensureCustomers: accounts.ensureSchema,
  });
  const customerId = randomUUID(),
    otherId = randomUUID();
  const actor = (type, id, email, session, founder = false) => ({
    type,
    id,
    email,
    session: digest(session),
    founder,
  });
  const customer = actor(
      "CUSTOMER",
      customerId,
      "customer@isolated.test",
      "CUSTOMER",
    ),
    other = actor("CUSTOMER", otherId, "other@isolated.test", "OTHER");
  const founder = actor(
      "STAFF",
      "founder",
      "founder@isolated.test",
      "FOUNDER",
      true,
    ),
    reviewer = actor("STAFF", "reviewer", "reviewer@isolated.test", "REVIEWER"),
    reviewer2 = actor(
      "STAFF",
      "reviewer-two",
      "reviewer-two@isolated.test",
      "REVIEWER2",
    );
  const secret = randomBytes(32),
    acknowledgements = new Map();
  let executeCalls = 0,
    loseExecuteResponse = true,
    statementRows = [];
  const signature = (raw, timestamp) =>
    createHmac("sha256", secret)
      .update(timestamp + ".")
      .update(raw)
      .digest("hex");
  const provider = {
    idempotent: true,
    screen: async () => ({
      status: "CLEAR",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    }),
    quote: async (request) => ({
      providerQuoteId: randomUUID(),
      sourceCurrency: request.sourceCurrency,
      targetCurrency: request.targetCurrency,
      sendMinor: request.sendMinor,
      feeMinor: "10",
      costMinor: "3",
      receiveMinor: "18000",
      exchangeRate: "18",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      costSource: "FEE",
    }),
    prepareFunding: async (request) => {
      const value = {
        reference: "collection-" + request.transferId,
        instructions: "Isolated provider funding instructions",
      };
      acknowledgements.set(request.idempotencyKey, value);
      return value;
    },
    execute: async (request) => {
      executeCalls++;
      const value = { reference: "payment-" + request.transferId };
      acknowledgements.set(request.idempotencyKey, value);
      if (loseExecuteResponse) {
        loseExecuteResponse = false;
        throw Error("Isolated response lost after provider accepted");
      }
      return value;
    },
    refund: async (request) => {
      const value = { reference: "refund-" + request.transferId };
      acknowledgements.set(request.idempotencyKey, value);
      return value;
    },
    lookup: async (request) =>
      acknowledgements.get(request.idempotencyKey) || { status: "NOT_FOUND" },
    statement: async () => statementRows,
    verifyEvent: async (raw, headers) => {
      const timestamp = headers["x-fixture-time"];
      if (
        !timestamp ||
        Math.abs(Date.now() - Number(timestamp)) > 300000 ||
        headers["x-fixture-signature"] !== signature(raw, timestamp)
      )
        return null;
      return JSON.parse(raw.toString());
    },
  };
  const engine = createGptsPaymentEngine({
    query,
    withTransaction,
    ensureFoundation: foundation.ensureSchema,
    vault: createVault({ key: randomBytes(32).toString("base64") }),
    adapters: new Map([["fixture-wire", provider]]),
  });
  const configured = {
    approvalQuorum: 2,
    verificationQuorum: 2,
    verificationChecks: ["Check identity document", "Confirm customer details"],
    routes: [
      {
        corridor: "ZW-ZA",
        sourceCurrency: "USD",
        targetCurrency: "ZAR",
        providerKey: "fixture-wire",
        maxTransferMinor: "100000",
        maxRolling24hMinor: "500000",
        enabled: true,
      },
    ],
  };
  const send = async (payload) => {
    const raw = Buffer.from(JSON.stringify(payload)),
      timestamp = String(Date.now());
    return engine.ingest("fixture-wire", raw, {
      "x-fixture-time": timestamp,
      "x-fixture-signature": signature(raw, timestamp),
    });
  };
  const event = (transfer, type, amount, reference = randomUUID()) => ({
    id: randomUUID(),
    type,
    transferId: transfer.transfer_id,
    reference,
    currency: "USD",
    amountMinor: amount,
  });
  let recipientId, caseId, primary, customerToken, staffToken, server;
  async function instruction() {
    const instructionId = randomUUID();
    await query(
      "INSERT INTO gpts_payment_instructions(instruction_id,customer_id,client_request_id,payload_hash,corridor_id,currency,amount,recipient_name,payout_method,purpose) VALUES($1,$2,$3,$4,'ZW-ZA','USD',10.00,'Isolated Recipient','BANK','Fixture only')",
      [instructionId, customerId, randomUUID(), "a".repeat(64)],
    );
    return instructionId;
  }
  async function transfer() {
    const quote = await engine.requestQuote(customer, {
      instructionId: await instruction(),
      recipientId,
      targetCurrency: "ZAR",
    });
    const accepted = await engine.acceptQuote(customer, {
      quoteId: quote.quoteId,
      requestId: randomUUID(),
      termsHash: quote.termsHash,
      accept: true,
    });
    await engine.runOneJob();
    return accepted;
  }
  const row = async (transferId) =>
    (
      await query("SELECT * FROM gpts_payment_transfers WHERE transfer_id=$1", [
        transferId,
      ])
    ).rows[0];
  const journalCount = async () =>
    (await query("SELECT COUNT(*)::int AS count FROM gpts_money_journals"))
      .rows[0].count;
  try {
    await t.test(
      "real schema migration, zero opening balances and no inherited staff authority",
      async () => {
        await engine.ensure();
        await query(
          "CREATE TABLE gft_admin_accounts(admin_id TEXT PRIMARY KEY,name TEXT,email TEXT,password_hash TEXT,role TEXT,active BOOLEAN,status TEXT)",
        );
        for (const [id, email] of [
          [customerId, customer.email],
          [otherId, other.email],
        ])
          await query(
            "INSERT INTO gpts_customers(customer_id,email,full_name,password_hash,country,service,email_verified_at) VALUES($1,$2,'Isolated Customer','fixture-hash','ZW','BOTH',NOW())",
            [id, email],
          );
        for (const staff of [founder, reviewer, reviewer2])
          await query(
            "INSERT INTO gft_admin_accounts VALUES($1,$1,$2,'fixture-hash','ADMIN',TRUE,'ACTIVE')",
            [staff.id, staff.email],
          );
        assert.equal(await journalCount(), 0);
        assert.equal(
          (await query("SELECT * FROM gpts_money_accounts")).rows.length,
          0,
        );
        assert.equal(await engine.policy(), null);
        await assert.rejects(
          engine.authorise(reviewer, "payments:review"),
          (error) => error.status === 403,
        );
        await engine.grant(founder, reviewer.id, [
          "operations:view",
          "verification:review",
          "payments:review",
          "finance:reconcile",
          "support:manage",
        ]);
        await engine.grant(founder, reviewer2.id, [
          "operations:view",
          "verification:review",
          "payments:review",
        ]);
        await engine.authorise(reviewer, "payments:review");
        await assert.rejects(
          engine.authorise(customer, "payments:review"),
          (error) => error.status === 403,
        );
        await engine.savePolicy(founder, configured);
      },
    );
    await t.test(
      "authenticator enrollment, session-bound step-up, recovery and persistent lock",
      async () => {
        const setup = await engine.startMfa(customer),
          confirmed = await engine.confirmMfa(
            customer,
            totp(setup.secret, Math.floor(Date.now() / 30000)),
            { enrol: true },
          );
        customerToken = confirmed.token;
        assert.equal(confirmed.recoveryCodes.length, 10);
        await engine.stepup(customer, customerToken);
        await assert.rejects(
          engine.stepup(
            { ...customer, session: digest("another-session") },
            customerToken,
          ),
          (error) => error.status === 403,
        );
        await assert.rejects(
          engine.confirmMfa(
            customer,
            totp(setup.secret, Math.floor(Date.now() / 30000)),
          ),
          (error) => error.status === 400,
        );
        const recovered = await engine.confirmMfa(
          customer,
          confirmed.recoveryCodes[0],
        );
        customerToken = recovered.token;
        await assert.rejects(
          engine.confirmMfa(customer, confirmed.recoveryCodes[0]),
          (error) => error.status === 400,
        );
        const staffSetup = await engine.startMfa(reviewer);
        staffToken = (
          await engine.confirmMfa(
            reviewer,
            totp(staffSetup.secret, Math.floor(Date.now() / 30000)),
            { enrol: true },
          )
        ).token;
        const otherSetup = await engine.startMfa(other);
        await engine.confirmMfa(
          other,
          totp(otherSetup.secret, Math.floor(Date.now() / 30000)),
          { enrol: true },
        );
        const wrong =
          totp(otherSetup.secret, Math.floor(Date.now() / 30000)) === "000000"
            ? "111111"
            : "000000";
        for (let i = 0; i < 5; i++)
          await assert.rejects(engine.confirmMfa(other, wrong));
        assert.ok((await engine.securityStatus(other)).lockedUntil);
        await assert.rejects(
          engine.confirmMfa(other, wrong),
          (error) => error.status === 429,
        );
      },
    );
    await t.test(
      "encrypted recipient versions and document verification quorum",
      async () => {
        recipientId = await engine.addRecipient(customer, {
          label: "Isolated Recipient",
          country: "ZA",
          method: "BANK",
          name: "Isolated Recipient",
          account: "private-account-1234",
          network: "Isolated network",
        });
        const recipient = (
          await query("SELECT * FROM gpts_recipients WHERE recipient_id=$1", [
            recipientId,
          ])
        ).rows[0];
        assert.equal(recipient.last_four, "1234");
        assert.ok(
          !Buffer.from(recipient.details_enc).includes(
            Buffer.from("private-account"),
          ),
        );
        await assert.rejects(
          engine.archiveRecipient(other, recipientId),
          (error) => error.status === 404,
        );
        caseId = await engine.verification(customer, {
          legalName: "Isolated Customer",
          dateOfBirth: "1990-01-01",
          identityType: "NATIONAL_ID",
          identityNumber: "PRIVATE-IDENTITY",
          address: "Isolated address for automated tests",
        });
        await assert.rejects(
          engine.submitVerification(customer, caseId),
          (error) => error.status === 400,
        );
        await assert.rejects(
          engine.uploadIdentity(
            customer,
            caseId,
            "IDENTITY_FRONT",
            Buffer.from("<svg>not an identity image</svg>"),
          ),
          (error) => error.status === 400,
        );
        const image = await sharp({
          create: { width: 8, height: 8, channels: 3, background: "#fff" },
        })
          .png()
          .toBuffer();
        await engine.uploadIdentity(customer, caseId, "IDENTITY_FRONT", image);
        await engine.submitVerification(customer, caseId);
        await assert.rejects(
          engine.reviewVerification(
            { ...reviewer, email: customer.email },
            caseId,
            {
              decision: "APPROVE",
              checks: configured.verificationChecks,
              reason: "Isolated review evidence",
            },
          ),
          (error) => error.status === 403,
        );
        await assert.rejects(
          engine.reviewVerification(reviewer, caseId, {
            decision: "APPROVE",
            checks: [],
            reason: "Isolated review evidence",
          }),
          (error) => error.status === 400,
        );
        assert.equal(
          await engine.reviewVerification(reviewer, caseId, {
            decision: "APPROVE",
            checks: configured.verificationChecks,
            reason: "Isolated review evidence",
          }),
          "SUBMITTED",
        );
        assert.equal(
          await engine.reviewVerification(reviewer2, caseId, {
            decision: "APPROVE",
            checks: configured.verificationChecks,
            reason: "Independent isolated review",
          }),
          "VERIFIED",
        );
        assert.equal(
          (
            await query(
              "SELECT financial_verification FROM gpts_customers WHERE customer_id=$1",
              [customerId],
            )
          ).rows[0].financial_verification,
          "VERIFIED",
        );
      },
    );
    await t.test(
      "quote ownership, exact consent, duplicate acceptance and recipient changes",
      async () => {
        const quote = await engine.requestQuote(customer, {
          instructionId: await instruction(),
          recipientId,
          targetCurrency: "ZAR",
        });
        await assert.rejects(
          engine.acceptQuote(other, {
            quoteId: quote.quoteId,
            requestId: randomUUID(),
            termsHash: quote.termsHash,
            accept: true,
          }),
        );
        await assert.rejects(
          engine.acceptQuote(customer, {
            quoteId: quote.quoteId,
            requestId: randomUUID(),
            termsHash: "0".repeat(64),
            accept: true,
          }),
        );
        const requestId = randomUUID(),
          body = {
            quoteId: quote.quoteId,
            requestId,
            termsHash: quote.termsHash,
            accept: true,
          };
        primary = await engine.acceptQuote(customer, body);
        assert.equal(
          (await engine.acceptQuote(customer, body)).transfer_id,
          primary.transfer_id,
        );
        await assert.rejects(
          engine.acceptQuote(customer, { ...body, termsHash: "b".repeat(64) }),
          (error) => error.status === 409,
        );
        const oldQuote = await engine.requestQuote(customer, {
          instructionId: await instruction(),
          recipientId,
          targetCurrency: "ZAR",
        });
        recipientId = await engine.addRecipient(
          customer,
          {
            label: "Replacement recipient",
            country: "ZA",
            method: "BANK",
            name: "Isolated Recipient",
            account: "replacement-5678",
            network: "Isolated network",
          },
          recipientId,
        );
        await assert.rejects(
          engine.acceptQuote(customer, {
            quoteId: oldQuote.quoteId,
            requestId: randomUUID(),
            termsHash: oldQuote.termsHash,
            accept: true,
          }),
          (error) => error.status === 409,
        );
        await engine.runOneJob();
        assert.equal((await row(primary.transfer_id)).status, "AWAITING_FUNDS");
      },
    );
    await t.test(
      "only verified funding posts money; replay and mismatches never duplicate it",
      async () => {
        const funded = event(primary, "FUNDED", "1010");
        await assert.rejects(
          engine.ingest(
            "fixture-wire",
            Buffer.from(JSON.stringify(funded)),
            {},
          ),
          (error) => error.status === 401,
        );
        assert.equal(await journalCount(), 0);
        await Promise.all([send(funded), send(funded)]);
        assert.equal(
          (await row(primary.transfer_id)).status,
          "PENDING_APPROVAL",
        );
        const count = await journalCount();
        assert.equal(count, 2);
        await send(funded);
        await send({ ...funded, id: randomUUID() });
        assert.equal(await journalCount(), count);
        assert.equal((await row(primary.transfer_id)).funded_minor, "1010");
        await assert.rejects(
          send({ ...funded, amountMinor: "2000" }),
          (error) => error.status === 409,
        );
        await assert.rejects(
          send({
            ...funded,
            id: randomUUID(),
            reference: randomUUID(),
            currency: "ZAR",
          }),
        );
        assert.equal(await journalCount(), count);
        assert.equal(
          (
            await query(
              "SELECT * FROM gpts_money_accounts WHERE kind IN('INCOME','EXPENSE')",
            )
          ).rows.length,
          0,
          "No fees earned before settlement",
        );
      },
    );
    await t.test(
      "independent approvals, durable execution and recovery after a lost provider response",
      async () => {
        const vote = {
          operation: "EXECUTE",
          decision: "APPROVE",
          reason: "Isolated approval evidence",
        };
        await engine.linkStaffCustomer(founder, reviewer.id, customerId, true);
        await assert.rejects(
          engine.vote(reviewer, primary.transfer_id, vote),
          (error) => error.status === 403,
        );
        await engine.linkStaffCustomer(founder, reviewer.id, customerId, false);
        await engine.vote(reviewer, primary.transfer_id, vote);
        assert.equal(
          (
            await query(
              "SELECT * FROM gpts_payment_jobs WHERE operation='EXECUTE'",
            )
          ).rows.length,
          0,
        );
        await assert.rejects(engine.vote(reviewer, primary.transfer_id, vote));
        await engine.vote(reviewer2, primary.transfer_id, vote);
        await engine.runOneJob();
        assert.equal((await row(primary.transfer_id)).status, "PROCESSING");
        assert.equal(
          (await query("SELECT * FROM gpts_payment_receipts")).rows.length,
          0,
        );
        await query(
          "UPDATE gpts_payment_jobs SET next_attempt_at=NOW()-INTERVAL '1 minute' WHERE operation='EXECUTE'",
        );
        await engine.runOneJob();
        assert.equal(
          executeCalls,
          1,
          "recovery queries the original idempotency key instead of issuing another payment",
        );
        assert.equal((await row(primary.transfer_id)).status, "PROCESSING");
        await send({
          ...event(primary, "SETTLED", "1000"),
          receiveCurrency: "ZAR",
          receiveMinor: "18000",
          costMinor: "3",
        });
        assert.equal((await row(primary.transfer_id)).status, "SETTLED");
        assert.equal(
          (await query("SELECT * FROM gpts_payment_receipts")).rows.length,
          1,
        );
        const sums = (
          await query(
            "SELECT l.currency,SUM(l.signed_minor)::text AS amount FROM gpts_money_lines l GROUP BY l.currency",
          )
        ).rows;
        assert.ok(sums.every((row) => row.amount === "0"));
        const liabilities = (
          await query(
            "SELECT SUM(l.signed_minor)::text AS amount FROM gpts_money_lines l JOIN gpts_money_accounts a USING(account_id,currency) WHERE a.transfer_id=$1 AND a.kind='LIABILITY'",
            [primary.transfer_id],
          )
        ).rows[0].amount;
        assert.equal(liabilities, "0");
      },
    );
    await t.test(
      "confirmed failure and partial/full refunds retain separate accounting",
      async () => {
        const failed = await transfer();
        await send(event(failed, "FUNDED", "1010"));
        for (const staff of [reviewer, reviewer2])
          await engine.vote(staff, failed.transfer_id, {
            operation: "EXECUTE",
            decision: "APPROVE",
            reason: "Isolated approval evidence",
          });
        await engine.runOneJob();
        await send(event(failed, "FAILED", "0"));
        assert.equal((await row(failed.transfer_id)).status, "FAILED");
        await engine.requestRefund(
          reviewer,
          failed.transfer_id,
          "Provider confirmed this isolated failure",
        );
        await assert.rejects(
          engine.vote(reviewer, failed.transfer_id, {
            operation: "REFUND",
            decision: "APPROVE",
            reason: "Self approval must fail",
          }),
          (error) => error.status === 403,
        );
        for (const staff of [reviewer2, founder])
          await engine.vote(staff, failed.transfer_id, {
            operation: "REFUND",
            decision: "APPROVE",
            reason: "Independent refund approval",
          });
        await engine.runOneJob();
        assert.equal((await row(failed.transfer_id)).status, "REFUNDING");
        await send(event(failed, "REFUNDED", "400"));
        assert.equal((await row(failed.transfer_id)).status, "REFUNDING");
        await send(event(failed, "REFUNDED", "610"));
        assert.equal((await row(failed.transfer_id)).status, "REFUNDED");
        assert.equal((await row(failed.transfer_id)).held_minor, "0");
        assert.equal(
          (
            await query(
              "SELECT * FROM gpts_payment_receipts WHERE transfer_id=$1",
              [failed.transfer_id],
            )
          ).rows.length,
          0,
        );
      },
    );
    await t.test(
      "audit failure rolls back journals and state, while the verified event remains retryable",
      async () => {
        const pending = await transfer(),
          funded = event(pending, "FUNDED", "1010"),
          before = await journalCount();
        await query(
          "CREATE FUNCTION fixture_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PROVIDER_FUNDED' THEN RAISE EXCEPTION 'Isolated audit write failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON gpts_ops_events FOR EACH ROW EXECUTE FUNCTION fixture_audit_failure()",
        );
        await assert.rejects(send(funded));
        assert.equal(await journalCount(), before);
        assert.equal((await row(pending.transfer_id)).funded_minor, "0");
        assert.equal(
          (
            await query(
              "SELECT status FROM gpts_provider_events WHERE event_id=$1",
              [funded.id],
            )
          ).rows[0].status,
          "ERROR",
        );
        await query("DROP TRIGGER fixture_audit_failure ON gpts_ops_events");
        await send(funded);
        assert.equal((await row(pending.transfer_id)).funded_minor, "1010");
        assert.equal(await journalCount(), before + 2);
      },
    );
    await t.test(
      "database rejects unbalanced, cross-currency and historical journal tampering",
      async () => {
        const before = await journalCount();
        await assert.rejects(
          withTransaction(async (client) => {
            const journal = randomUUID();
            await client.query(
              "INSERT INTO gpts_money_journals(journal_id,event_key,payload_hash,transfer_id,kind) VALUES($1,$2,$3,$4,'INVALID')",
              [journal, randomUUID(), "a".repeat(64), primary.transfer_id],
            );
            await client.query(
              "INSERT INTO gpts_money_lines VALUES($1,$2,'USD',1)",
              [journal, "CASH:" + primary.transfer_id],
            );
          }),
        );
        assert.equal(await journalCount(), before);
        await assert.rejects(query("DELETE FROM gpts_money_journals"));
        await assert.rejects(
          query(
            "UPDATE gpts_payment_transfers SET terms='{}'::jsonb WHERE transfer_id=$1",
            [primary.transfer_id],
          ),
        );
        await assert.rejects(query("DELETE FROM gpts_ops_events"));
        await assert.rejects(query("DELETE FROM gpts_payment_receipts"));
        await assert.rejects(
          withTransaction(async (client) => {
            const journal = randomUUID(),
              one = randomUUID(),
              two = randomUUID();
            await client.query(
              "INSERT INTO gpts_money_accounts(account_id,customer_id,transfer_id,currency,kind) VALUES($1,$2,$3,'USD','ASSET'),($4,$2,$3,'ZAR','ASSET')",
              [one, customerId, primary.transfer_id, two],
            );
            await client.query(
              "INSERT INTO gpts_money_journals(journal_id,event_key,payload_hash,transfer_id,kind) VALUES($1,$2,$3,$4,'CROSS_CURRENCY_INVALID')",
              [journal, randomUUID(), "b".repeat(64), primary.transfer_id],
            );
            await client.query(
              "INSERT INTO gpts_money_lines VALUES($1,$2,'USD',1),($1,$3,'ZAR',-1)",
              [journal, one, two],
            );
          }),
        );
        const committed = (
          await query("SELECT journal_id FROM gpts_money_journals LIMIT 1")
        ).rows[0].journal_id;
        await assert.rejects(
          query("INSERT INTO gpts_money_lines VALUES($1,$2,'USD',1)", [
            committed,
            "FEE_REVENUE:" + primary.transfer_id,
          ]),
        );
        assert.equal(await journalCount(), before);
      },
    );
    await t.test(
      "restrictions block new quotes; support separates internal notes and customer messages",
      async () => {
        await engine.freeze(
          founder,
          customer.id,
          true,
          "Isolated compliance review hold",
        );
        await assert.rejects(
          engine.requestQuote(customer, {
            instructionId: await instruction(),
            recipientId,
            targetCurrency: "ZAR",
          }),
          (error) => error.status === 423,
        );
        await engine.freeze(
          founder,
          customer.id,
          false,
          "Independent review cleared the isolated hold",
        );
        const caseId = await engine.openSupport(customer, {
          category: "COMPLAINT",
          subject: "Isolated transfer question",
          message: "Please investigate this isolated case.",
        });
        await engine.replySupport(reviewer, caseId, {
          message: "Internal investigation note only.",
          internal: true,
          status: "IN_PROGRESS",
        });
        await engine.replySupport(reviewer, caseId, {
          message: "Customer-visible response recorded.",
          internal: false,
          status: "CLOSED",
        });
        await assert.rejects(
          engine.replySupport(other, caseId, {
            message: "Another customer must not reply.",
          }),
          (error) => error.status === 404,
        );
        const visible = (
          await query(
            "SELECT * FROM gpts_support_messages WHERE case_id=$1 AND internal=FALSE",
            [caseId],
          )
        ).rows;
        assert.equal(visible.length, 2);
      },
    );
    await t.test(
      "authenticated provider-status recovery and a blocked dispatch preserve accounting",
      async () => {
        const pending = await transfer(),
          before = await journalCount(),
          originalLookup = provider.lookup;
        const funded = event(pending, "FUNDED", "1010");
        provider.lookup = async () => ({
          reference: "collection-" + pending.transfer_id,
          event: funded,
        });
        assert.equal(
          (await engine.providerStatus(customer, pending.transfer_id)).status,
          "PENDING_APPROVAL",
        );
        await engine.providerStatus(customer, pending.transfer_id);
        assert.equal(await journalCount(), before + 2);
        await assert.rejects(
          engine.providerStatus(other, pending.transfer_id),
          (error) => error.status === 404,
        );
        provider.lookup = originalLookup;
        for (const staff of [reviewer, reviewer2])
          await engine.vote(staff, pending.transfer_id, {
            operation: "EXECUTE",
            decision: "APPROVE",
            reason: "Isolated independent approval",
          });
        await engine.freeze(
          founder,
          customerId,
          true,
          "Isolated restriction before dispatch",
        );
        const calls = executeCalls;
        await engine.runOneJob();
        assert.equal(executeCalls, calls);
        assert.equal(
          (await row(pending.transfer_id)).status,
          "REVIEW_REQUIRED",
        );
        assert.equal((await row(pending.transfer_id)).held_minor, "1010");
        await engine.freeze(
          founder,
          customerId,
          false,
          "Restriction cleared by isolated review",
        );
        const job = (
          await query(
            "SELECT job_id FROM gpts_payment_jobs WHERE transfer_id=$1 AND operation='EXECUTE'",
            [pending.transfer_id],
          )
        ).rows[0];
        await engine.resumeJob(
          reviewer,
          job.job_id,
          "Independent recovery after restriction cleared",
        );
        await engine.runOneJob();
        assert.equal((await row(pending.transfer_id)).status, "PROCESSING");
      },
    );
    await t.test(
      "configured limits and adverse screening block transfers without creating money",
      async () => {
        const total = (
          await query(
            "SELECT COALESCE(SUM((terms->>'totalMinor')::numeric),0)::text AS amount FROM gpts_payment_transfers WHERE customer_id=$1 AND status<>'CANCELLED'",
            [customerId],
          )
        ).rows[0].amount;
        await engine.savePolicy(founder, {
          ...configured,
          routes: [
            {
              ...configured.routes[0],
              maxTransferMinor: "1010",
              maxRolling24hMinor: String(BigInt(total) + 1n),
            },
          ],
        });
        const quote = await engine.requestQuote(customer, {
          instructionId: await instruction(),
          recipientId,
          targetCurrency: "ZAR",
        });
        await assert.rejects(
          engine.acceptQuote(customer, {
            quoteId: quote.quoteId,
            requestId: randomUUID(),
            termsHash: quote.termsHash,
            accept: true,
          }),
          (error) => error.status === 409,
        );
        await engine.savePolicy(founder, configured);
        const original = provider.screen;
        provider.screen = async () => ({
          status: "REVIEW",
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        });
        const count = await journalCount();
        await assert.rejects(
          engine.requestQuote(customer, {
            instructionId: await instruction(),
            recipientId,
            targetCurrency: "ZAR",
          }),
          (error) => error.status === 409,
        );
        assert.equal(await journalCount(), count);
        assert.equal(
          (
            await query(
              "SELECT * FROM gpts_ops_events WHERE action='SCREENING_REVIEW_REQUIRED'",
            )
          ).rows.length,
          1,
        );
        provider.screen = original;
      },
    );
    await t.test(
      "partial funding stays available until the exact accepted funding total arrives",
      async () => {
        const pending = await transfer();
        await send(event(pending, "FUNDED", "1000"));
        assert.equal((await row(pending.transfer_id)).status, "AWAITING_FUNDS");
        assert.equal((await row(pending.transfer_id)).held_minor, "0");
        await send(event(pending, "FUNDED", "10"));
        assert.equal(
          (await row(pending.transfer_id)).status,
          "PENDING_APPROVAL",
        );
        assert.equal((await row(pending.transfer_id)).held_minor, "1010");
      },
    );
    await t.test(
      "correction requests keep internal evidence separate from customer-facing guidance",
      async () => {
        const own = await engine.verification(other, {
          legalName: "Other Isolated Customer",
          dateOfBirth: "1991-01-01",
          identityType: "PASSPORT",
          identityNumber: "OTHER-PRIVATE-IDENTITY",
          address: "Another isolated test address",
        });
        const image = await sharp({
          create: { width: 8, height: 8, channels: 3, background: "#fff" },
        })
          .jpeg()
          .toBuffer();
        await engine.uploadIdentity(other, own, "IDENTITY_FRONT", image);
        await engine.uploadIdentity(other, own, "IDENTITY_FRONT", image);
        await engine.submitVerification(other, own);
        await assert.rejects(
          engine.reviewVerification(reviewer, own, {
            decision: "CHANGES_REQUIRED",
            checks: [],
            reason: "PRIVATE INTERNAL EVIDENCE",
          }),
          (error) => error.status === 400,
        );
        await engine.reviewVerification(reviewer, own, {
          decision: "CHANGES_REQUIRED",
          checks: [],
          reason: "PRIVATE INTERNAL EVIDENCE",
          customerMessage: "Please upload a clearer identity-document image.",
        });
        assert.equal(
          (
            await query(
              "SELECT status FROM gpts_verifications WHERE case_id=$1",
              [own],
            )
          ).rows[0].status,
          "CHANGES_REQUIRED",
        );
      },
    );
    await t.test(
      "reconciliation detects differences and cannot manufacture a resolution",
      async () => {
        const posted = (
          await query(
            "SELECT j.event_key,j.transfer_id,l.currency,l.signed_minor::text FROM gpts_money_lines l JOIN gpts_money_journals j USING(journal_id) WHERE l.account_id LIKE 'CASH:%' ORDER BY j.created_at LIMIT 1",
          )
        ).rows[0];
        statementRows = [
          {
            rowId: randomUUID(),
            transferId: posted.transfer_id,
            currency: posted.currency,
            signedMinor: posted.signed_minor,
            eventKey: posted.event_key,
            observedAt: new Date().toISOString(),
          },
        ];
        assert.equal(
          (await engine.reconcile(reviewer, "fixture-wire", "2026-11-28"))
            .issues,
          0,
        );
        statementRows = [
          { ...statementRows[0], rowId: randomUUID(), signedMinor: "999" },
        ];
        assert.equal(
          (await engine.reconcile(reviewer, "fixture-wire", "2026-11-28"))
            .issues,
          1,
        );
        const issue = (
          await query(
            "SELECT issue_id FROM gpts_reconciliation_issues WHERE status='OPEN' LIMIT 1",
          )
        ).rows[0];
        await assert.rejects(
          engine.resolveIssue(
            reviewer,
            issue.issue_id,
            "This must not force a balancing entry.",
          ),
          (error) => error.status === 409,
        );
        await assert.rejects(
          query("UPDATE gpts_statement_rows SET signed_minor=0"),
        );
      },
    );
    await t.test(
      "HTTP permissions, owner isolation, step-up and document access",
      async () => {
        const app = express();
        app.use(
          express.json({
            verify: (req, _res, body) => {
              req.gptsRawBody = Buffer.from(body);
            },
          }),
        );
        const getCookie = (req) => req.get("x-session") || "";
        installGptsPaymentOperations(app, {
          engine,
          query,
          getCookie,
          verifyPassword: async () => true,
          getCustomer: async (req) =>
            req.get("x-session") === "CUSTOMER"
              ? { customer_id: customer.id, email: customer.email }
              : req.get("x-session") === "OTHER"
                ? { customer_id: other.id, email: other.email }
                : null,
          getAdmin: async (req) =>
            req.get("x-session") === "REVIEWER"
              ? { admin_id: reviewer.id, email: reviewer.email, role: "ADMIN" }
              : req.get("x-session") === "FOUNDER"
                ? {
                    admin_id: founder.id,
                    email: founder.email,
                    role: "FOUNDER",
                  }
                : null,
        });
        server = app.listen(0, "127.0.0.1");
        await new Promise((resolve) => server.once("listening", resolve));
        const url = "http://127.0.0.1:" + server.address().port;
        const request = (path, session = "CUSTOMER", body, token) =>
          fetch(url + path, {
            headers: {
              "x-session": session,
              ...(body ? { "Content-Type": "application/json" } : {}),
              ...(token ? { "X-GPTS-Stepup": token } : {}),
            },
            ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
          });
        const base = "/api/gpts-payments/control";
        assert.equal(
          (await request(base + "/customer/overview", "")).status,
          401,
        );
        assert.equal(
          (await request(base + "/operations/overview")).status,
          401,
        );
        assert.equal(
          (
            await request(base + "/customer/recipients", "CUSTOMER", {
              label: "Not confirmed",
            })
          ).status,
          403,
        );
        const recipients = await (
          await request(base + "/customer/recipients")
        ).json();
        assert.ok(
          recipients.recipients.every(
            (row) => !("details_enc" in row) && !("account" in row),
          ),
        );
        assert.equal(
          (
            await request(
              base + "/customer/transfers/" + primary.transfer_id + "/receipt",
              "OTHER",
            )
          ).status,
          404,
        );
        const corrections = await (
          await request(base + "/customer/verification", "OTHER")
        ).json();
        assert.ok(
          JSON.stringify(corrections).includes("Please upload a clearer"),
        );
        assert.ok(
          !JSON.stringify(corrections).includes("PRIVATE INTERNAL EVIDENCE"),
        );
        const receipt = await (
          await request(
            base + "/customer/transfers/" + primary.transfer_id + "/receipt",
          )
        ).json();
        assert.equal(receipt.receipt.summary.transferId, primary.transfer_id);
        assert.equal(
          (
            await request(
              base + "/operations/verifications/" + caseId,
              "REVIEWER",
            )
          ).status,
          403,
        );
        const detail = await (
          await request(
            base + "/operations/verifications/" + caseId,
            "REVIEWER",
            undefined,
            staffToken,
          )
        ).json();
        assert.equal(detail.identity.identityNumber, "PRIVATE-IDENTITY");
        const image = await request(
          base + "/operations/images/" + detail.images[0].image_id,
          "REVIEWER",
          undefined,
          staffToken,
        );
        assert.equal(image.headers.get("content-type"), "image/jpeg");
        assert.match(image.headers.get("content-disposition"), /attachment/);
        assert.equal(
          (
            await request(
              base + "/customer/transfers/" + primary.transfer_id + "/settle",
              "CUSTOMER",
              {},
              customerToken,
            )
          ).status,
          404,
        );
        await query(
          "UPDATE gpts_stepup SET expires_at=NOW()-INTERVAL '1 minute' WHERE token_hash=$1",
          [digest(customerToken)],
        );
        assert.equal(
          (
            await request(
              base + "/customer/recipients/" + recipientId + "/archive",
              "CUSTOMER",
              {},
              customerToken,
            )
          ).status,
          403,
        );
        await engine.grant(founder, reviewer.id, []);
        assert.equal(
          (await request(base + "/operations/overview", "REVIEWER")).status,
          403,
        );
      },
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});
