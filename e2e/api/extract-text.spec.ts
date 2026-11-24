import fs from "fs";
import path from "path";
import { expect, test } from "../fixtures";

/**
 * Extract-text endpoint diagnostic tests.
 * Tag: @api @debug
 *
 * Run against staging:
 *   E2E_BASE_URL=https://staging.isabel.example.com pnpm exec playwright test e2e/api/extract-text.spec.ts --project=chromium
 */

test.describe("Extract Text API @api @live", () => {
  test("POST /api/v1/extract-text requires authentication", async ({
    request,
  }) => {
    const response = await request.post("/api/v1/extract-text");
    console.log("[extract-text] Unauthenticated status:", response.status());
    expect(response.status()).toBe(401);
  });

  test("POST /api/v1/extract-text with small text file", async ({
    authedRequest,
  }) => {
    // Create a minimal CSV in-memory
    const csvContent = "name,value\ntest,123\n";
    const csvBuffer = Buffer.from(csvContent, "utf-8");

    const response = await authedRequest.post("/api/v1/extract-text", {
      multipart: {
        file: {
          name: "test.csv",
          mimeType: "text/csv",
          buffer: csvBuffer,
        },
      },
    });

    const status = response.status();
    const body = await response.text();
    console.log("[extract-text] CSV upload status:", status);
    console.log("[extract-text] CSV upload response:", body);

    if (status === 200) {
      const json = JSON.parse(body);
      expect(json.text).toBeTruthy();
      expect(json.metadata).toBeTruthy();
    } else {
      // Log full error details for diagnosis
      console.error("[extract-text] FAILURE — status:", status, "body:", body);
      const headers = response.headers();
      console.log(
        "[extract-text] Response headers:",
        JSON.stringify(headers, null, 2),
      );
    }
  });

  test("POST /api/v1/extract-text with PDF file", async ({ authedRequest }) => {
    // Create a minimal valid PDF
    const minimalPdf = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
        "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n" +
        "xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n" +
        "0000000115 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF",
    );

    const response = await authedRequest.post("/api/v1/extract-text", {
      multipart: {
        file: {
          name: "test.pdf",
          mimeType: "application/pdf",
          buffer: minimalPdf,
        },
      },
    });

    const status = response.status();
    const body = await response.text();
    console.log("[extract-text] PDF upload status:", status);
    console.log("[extract-text] PDF upload response:", body);

    if (status !== 200) {
      console.error(
        "[extract-text] PDF FAILURE — status:",
        status,
        "body:",
        body,
      );
      const headers = response.headers();
      console.log(
        "[extract-text] Response headers:",
        JSON.stringify(headers, null, 2),
      );
    }
  });

  test("POST /api/v1/extract-text with DOCX file", async ({
    authedRequest,
  }) => {
    // Try to find a real docx test fixture, otherwise skip
    const fixtureDir = path.join(process.cwd(), "e2e", "fixtures");
    const docxPath = path.join(fixtureDir, "test.docx");

    if (!fs.existsSync(docxPath)) {
      test.skip();
      return;
    }

    const docxBuffer = fs.readFileSync(docxPath);

    const response = await authedRequest.post("/api/v1/extract-text", {
      multipart: {
        file: {
          name: "test.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          buffer: docxBuffer,
        },
      },
    });

    const status = response.status();
    const body = await response.text();
    console.log("[extract-text] DOCX upload status:", status);
    console.log("[extract-text] DOCX upload response:", body);

    if (status !== 200) {
      console.error(
        "[extract-text] DOCX FAILURE — status:",
        status,
        "body:",
        body,
      );
    }
  });

  test("POST /api/v1/extract-text rejects oversized file", async ({
    authedRequest,
  }) => {
    // 11 MB of zeros — should be rejected (limit is 10 MB)
    const bigBuffer = Buffer.alloc(11 * 1024 * 1024, 0);

    const response = await authedRequest.post("/api/v1/extract-text", {
      multipart: {
        file: {
          name: "huge.csv",
          mimeType: "text/csv",
          buffer: bigBuffer,
        },
      },
    });

    const status = response.status();
    const body = await response.text();
    console.log("[extract-text] Oversized file status:", status);
    console.log("[extract-text] Oversized file response:", body);

    // Should be 413 (too large)
    expect(status).toBe(413);
  });
});
