import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import app from "../app";
import request from "supertest";

// Mock fetch
const originalFetch = global.fetch;

// Mock data
const mockIssue = {
  id: 123,
  number: 123,
  title: "Test Issue Title",
  body: "This is a test issue description",
  user: { login: "issue-author" },
  created_at: new Date("2023-01-01T12:00:00Z").toISOString(),
  state: "open",
  html_url: "http://github.com/owner/repo/issues/123",
  comments: 200 // Should trigger pagination
};

const mockCommentsPage1 = Array.from({ length: 100 }, (_, i) => ({
    id: i + 1,
    body: `Comment body ${i + 1}`,
    user: { login: `commenter${i + 1}` },
    created_at: new Date("2023-01-02T12:00:00Z").toISOString(),
    html_url: `http://github.com/owner/repo/issues/123#issuecomment-${i + 1}`,
}));

const mockCommentsPage2 = Array.from({ length: 100 }, (_, i) => ({
    id: 100 + i + 1,
    body: `Comment body ${100 + i + 1}`,
    user: { login: `commenter${100 + i + 1}` },
    created_at: new Date("2023-01-03T12:00:00Z").toISOString(),
    html_url: `http://github.com/owner/repo/issues/123#issuecomment-${100 + i + 1}`,
}));

describe("Pagination Support", () => {
  beforeAll(() => {
    // Mock fetch globally
    global.fetch = (async (url: string | URL | Request) => {
        const urlStr = url.toString();

        // Mock Issue Comments Page 1
        if (urlStr.includes("/issues/123/comments") && !urlStr.includes("page=2")) {
            return {
                ok: true,
                json: async () => mockCommentsPage1,
                text: async () => JSON.stringify(mockCommentsPage1),
                headers: {
                    get: (name: string) => {
                        if (name.toLowerCase() === 'link') {
                            return '<https://api.github.com/repos/owner/repo/issues/123/comments?per_page=100&page=2>; rel="next"';
                        }
                        return null;
                    }
                }
            } as any;
        }

        // Mock Issue Comments Page 2
        if (urlStr.includes("/issues/123/comments") && urlStr.includes("page=2")) {
             return {
                ok: true,
                json: async () => mockCommentsPage2,
                text: async () => JSON.stringify(mockCommentsPage2),
                headers: {
                    get: (name: string) => null // Last page
                }
            } as any;
        }

        // Mock Issue Details
        if (urlStr.includes("/issues/123")) {
             return {
                ok: true,
                json: async () => mockIssue,
                text: async () => JSON.stringify(mockIssue),
                headers: {
                    get: (name: string) => null
                }
            } as any;
        }

        return {
            ok: false,
            status: 404,
            statusText: "Not Found",
            text: async () => "Not Found"
        } as Response;
    }) as any;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  // Increased timeout to 30s because mocking and large response processing might take time
  test("GET /owner/repo/issues/123 fetches all pages of comments", async () => {
    const res = await request(app)
      .get("/owner/repo/issues/123?token=test")
      .timeout(30000)
      .expect(200);

    expect(res.text).toContain("Total Comments:** 200");
    expect(res.text).toContain("## Comment 1");
    expect(res.text).toContain("Comment body 1");
    expect(res.text).toContain("## Comment 100");
    expect(res.text).toContain("Comment body 100");
    expect(res.text).toContain("## Comment 200");
    expect(res.text).toContain("Comment body 200");
  }, 30000);
});
