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
  comments: 2
};

const mockComments = [
  {
    id: 1,
    body: "First comment body",
    user: { login: "commenter1" },
    created_at: new Date("2023-01-02T12:00:00Z").toISOString(),
    html_url: "http://github.com/owner/repo/issues/123#issuecomment-1",
  },
  {
    id: 2,
    body: "Second comment body",
    user: { login: "commenter2" },
    created_at: new Date("2023-01-03T12:00:00Z").toISOString(),
    html_url: "http://github.com/owner/repo/issues/123#issuecomment-2",
  }
];

describe("Issue Support", () => {
  beforeAll(() => {
    // Mock fetch globally
    global.fetch = (async (url: string | URL | Request) => {
        const urlStr = url.toString();

        // Mock Issue Comments
        if (urlStr.includes("/issues/123/comments")) {
            return {
                ok: true,
                json: async () => mockComments,
                text: async () => JSON.stringify(mockComments),
                headers: {
                    get: (name: string) => null // No pagination
                }
            } as any; // Cast to any to handle partial mock
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

  test("GET /owner/repo/issues/123 returns issue and comments", async () => {
    const res = await request(app)
      .get("/owner/repo/issues/123?token=test")
      .expect(200);

    expect(res.text).toContain("# Issue #123 Comments");
    expect(res.text).toContain("## Issue Description");
    expect(res.text).toContain("Test Issue Title");
    expect(res.text).toContain("This is a test issue description");
    expect(res.text).toContain("## Comment 1");
    expect(res.text).toContain("First comment body");
    expect(res.text).toContain("## Comment 2");
    expect(res.text).toContain("Second comment body");
    expect(res.text).toContain("commenter1");
    expect(res.text).toContain("commenter2");
  });

  test("GET /owner/repo/issues/123/1 returns specific comment without issue description", async () => {
    const res = await request(app)
      .get("/owner/repo/issues/123/1?token=test")
      .expect(200);

    expect(res.text).toContain("# Issue #123 Comments");
    expect(res.text).not.toContain("## Issue Description");
    expect(res.text).toContain("## Comment 1");
    expect(res.text).toContain("First comment body");
    expect(res.text).not.toContain("Second comment body");
  });

  test("GET /owner/repo/issues/123/2 returns second comment", async () => {
    const res = await request(app)
      .get("/owner/repo/issues/123/2?token=test")
      .expect(200);

    expect(res.text).toContain("## Comment 1"); // Wait, index 1 in the markdown means "Comment 1" of the response list
    // The response list contains only the second comment from the array.
    // So it will be labeled as "Comment 1" in the markdown output because loop index is 0.
    // Let's verify what the code does.
    // comments.forEach((comment, index) => { markdown += `## Comment ${index + 1}\n\n`; ... })
    // Yes, it will be "Comment 1".

    expect(res.text).toContain("Second comment body");
    expect(res.text).not.toContain("First comment body");
  });

  test("GET /owner/repo/issues/123 without token returns 401", async () => {
    // Ensure GITHUB_TOKEN is not set
    const originalToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;

    await request(app)
      .get("/owner/repo/issues/123")
      .expect(401);

    if (originalToken) process.env.GITHUB_TOKEN = originalToken;
  });
});
