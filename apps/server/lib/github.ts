/**
 * GitHub API client for Pull Request comments
 */

// Type definitions based on GitHub API schema

export type AuthorAssociation =
  | "COLLABORATOR"
  | "CONTRIBUTOR"
  | "FIRST_TIMER"
  | "FIRST_TIME_CONTRIBUTOR"
  | "MANNEQUIN"
  | "MEMBER"
  | "NONE"
  | "OWNER";

export type Side = "LEFT" | "RIGHT";

export type SubjectType = "line" | "file";

export interface SimpleUser {
  name?: string | null;
  email?: string | null;
  login: string;
  id: number;
  node_id: string;
  avatar_url: string;
  gravatar_id: string | null;
  url: string;
  html_url: string;
  followers_url: string;
  following_url: string;
  gists_url: string;
  starred_url: string;
  subscriptions_url: string;
  organizations_url: string;
  repos_url: string;
  events_url: string;
  received_events_url: string;
  type: string;
  site_admin: boolean;
  starred_at?: string;
  user_view_type?: string;
}

export interface ReactionRollup {
  url: string;
  total_count: number;
  "+1": number;
  "-1": number;
  laugh: number;
  confused: number;
  heart: number;
  hooray: number;
  eyes: number;
  rocket: number;
}

export interface PullRequestReviewCommentLinks {
  self: {
    href: string;
  };
  html: {
    href: string;
  };
  pull_request: {
    href: string;
  };
}

export interface PullRequestReviewComment {
  url: string;
  pull_request_review_id: number | null;
  id: number;
  node_id: string;
  diff_hunk: string;
  path: string;
  position?: number;
  original_position?: number;
  commit_id: string;
  original_commit_id: string;
  in_reply_to_id?: number;
  user: SimpleUser;
  body: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  pull_request_url: string;
  author_association: AuthorAssociation;
  _links: PullRequestReviewCommentLinks;
  start_line?: number | null;
  original_start_line?: number | null;
  start_side?: Side | null;
  line?: number;
  original_line?: number;
  side?: Side;
  subject_type?: SubjectType;
  reactions?: ReactionRollup;
  body_html?: string;
  body_text?: string;
}

export type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";

export interface PullRequestReview {
  id: number;
  node_id: string;
  user: SimpleUser;
  body: string | null;
  state: ReviewState;
  html_url: string;
  pull_request_url: string;
  author_association: AuthorAssociation;
  submitted_at: string;
  commit_id: string;
  _links: {
    html: { href: string };
    pull_request: { href: string };
  };
}

export interface Issue {
  id: number;
  node_id: string;
  url: string;
  repository_url: string;
  labels_url: string;
  comments_url: string;
  events_url: string;
  html_url: string;
  number: number;
  state: string;
  title: string;
  body: string | null;
  user: SimpleUser;
  labels: any[]; // Use any[] for simplicity unless specific label structure is needed
  assignee: SimpleUser | null;
  assignees: SimpleUser[];
  milestone: any | null;
  locked: boolean;
  active_lock_reason: string | null;
  comments: number;
  pull_request?: {
    url: string;
    html_url: string;
    diff_url: string;
    patch_url: string;
  };
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  author_association: AuthorAssociation;
  reactions: ReactionRollup;
}

export interface IssueComment {
  url: string;
  html_url: string;
  issue_url: string;
  id: number;
  node_id: string;
  user: SimpleUser;
  created_at: string;
  updated_at: string;
  author_association: AuthorAssociation;
  body: string;
  reactions?: ReactionRollup;
  performed_via_github_app?: any;
}

export interface GitHubPRCommentsOptions {
  owner: string;
  repo: string;
  pullRequestId: number;
  token: string;
}

export interface GitHubIssueOptions {
  owner: string;
  repo: string;
  issueNumber: number;
  token: string;
}

/**
 * Helper function to fetch paginated results from GitHub API
 *
 * @param url - The initial URL to fetch
 * @param token - GitHub personal access token
 * @returns Array of accumulated results
 */
async function fetchPaginated<T>(url: string, token: string): Promise<T[]> {
  let results: T[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `GitHub API request failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }

    const data = await response.json();
    results = results.concat(data as T[]);

    // Check for Link header to handle pagination
    const linkHeader = response.headers.get("link");
    const currentUrl = nextUrl; // Store current URL to compare
    nextUrl = null;

    if (linkHeader) {
      const links = linkHeader.split(",");
      for (const link of links) {
        const parts = link.split(";");
        if (parts.length < 2) continue;

        const urlPart = parts[0]!;
        const relPart = parts[1]!;

        if (relPart.includes('rel="next"')) {
          const newUrl = urlPart.trim().slice(1, -1);
          // Avoid infinite loop if next URL is same as current (shouldn't happen with correct API)
          if (newUrl !== currentUrl) {
              nextUrl = newUrl;
          }
          break;
        }
      }
    }
  }

  return results;
}

/**
 * Fetches all comments for a specific Pull Request
 * 
 * @param options - Configuration options for the API request
 * @returns Array of Pull Request Review Comments
 * @throws Error if the API request fails
 */
export async function fetchPullRequestComments(
  options: GitHubPRCommentsOptions
): Promise<PullRequestReviewComment[]> {
  const { owner, repo, pullRequestId, token } = options;
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${pullRequestId}/comments?per_page=100`;
  return fetchPaginated<PullRequestReviewComment>(url, token);
}

/**
 * Fetches all reviews for a specific Pull Request
 * 
 * @param options - Configuration options for the API request
 * @returns Array of Pull Request Reviews
 * @throws Error if the API request fails
 */
export async function fetchPullRequestReviews(
  options: GitHubPRCommentsOptions
): Promise<PullRequestReview[]> {
  const { owner, repo, pullRequestId, token } = options;
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${pullRequestId}/reviews?per_page=100`;
  return fetchPaginated<PullRequestReview>(url, token);
}

/**
 * Fetches an issue by number
 *
 * @param options - Configuration options for the API request
 * @returns The Issue object
 * @throws Error if the API request fails
 */
export async function fetchIssue(
  options: GitHubIssueOptions
): Promise<Issue> {
  const { owner, repo, issueNumber, token } = options;

  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `GitHub API request failed: ${response.status} ${response.statusText}\n${errorText}`
    );
  }

  const data = await response.json();
  return data as Issue;
}

/**
 * Fetches all comments for a specific Issue
 *
 * @param options - Configuration options for the API request
 * @returns Array of Issue Comments
 * @throws Error if the API request fails
 */
export async function fetchIssueComments(
  options: GitHubIssueOptions
): Promise<IssueComment[]> {
  const { owner, repo, issueNumber, token } = options;
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`;
  return fetchPaginated<IssueComment>(url, token);
}

/**
 * GitHub API client class for Pull Request operations
 */
export class GitHubClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  /**
   * Fetches all comments for a specific Pull Request
   * 
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param pullRequestId - Pull Request ID
   * @returns Array of Pull Request Review Comments
   */
  async getPullRequestComments(
    owner: string,
    repo: string,
    pullRequestId: number
  ): Promise<PullRequestReviewComment[]> {
    return fetchPullRequestComments({
      owner,
      repo,
      pullRequestId,
      token: this.token,
    });
  }

  /**
   * Fetches all reviews for a specific Pull Request
   * 
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param pullRequestId - Pull Request ID
   * @returns Array of Pull Request Reviews
   */
  async getPullRequestReviews(
    owner: string,
    repo: string,
    pullRequestId: number
  ): Promise<PullRequestReview[]> {
    return fetchPullRequestReviews({
      owner,
      repo,
      pullRequestId,
      token: this.token,
    });
  }

  /**
   * Fetches both reviews and comments for a specific Pull Request
   * 
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param pullRequestId - Pull Request ID
   * @returns Object containing both reviews and comments
   */
  async getPullRequestReviewsAndComments(
    owner: string,
    repo: string,
    pullRequestId: number
  ): Promise<{ reviews: PullRequestReview[]; comments: PullRequestReviewComment[] }> {
    const [reviews, comments] = await Promise.all([
      this.getPullRequestReviews(owner, repo, pullRequestId),
      this.getPullRequestComments(owner, repo, pullRequestId),
    ]);

    return { reviews, comments };
  }

  /**
   * Fetches an issue by number
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param issueNumber - Issue number
   * @returns The Issue object
   */
  async getIssue(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<Issue> {
    return fetchIssue({
      owner,
      repo,
      issueNumber,
      token: this.token,
    });
  }

  /**
   * Fetches all comments for a specific Issue
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param issueNumber - Issue number
   * @returns Array of Issue Comments
   */
  async getIssueComments(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<IssueComment[]> {
    return fetchIssueComments({
      owner,
      repo,
      issueNumber,
      token: this.token,
    });
  }
}
