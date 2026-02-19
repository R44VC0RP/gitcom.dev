import express, { type Request, type Response } from "express";
import {
  GitHubClient,
  type PullRequestReviewComment,
  type PullRequestReview,
  type Issue,
  type IssueComment,
} from "./lib/github.js";
import { encoding_for_model } from "tiktoken";

interface FormattingOptions {
  includeReviews: boolean;
  showThreading: boolean;
  resolvedFilter?: "true" | "false"; // Filter by resolved status
}

const app = express();

function countTokens(text: string): number {
  try {
    const encoder = encoding_for_model("gpt-4");
    const tokens = encoder.encode(text);
    const count = tokens.length;
    encoder.free();
    return count;
  } catch (error) {
    console.error("Error counting tokens:", error);
    return 0;
  }
}

function formatCommentsAsMarkdown(
  owner: string,
  repo: string,
  pullRequestId: number,
  comments: PullRequestReviewComment[]
): string {
  // Calculate total tokens from all comment bodies
  const totalTokens = comments.reduce((sum, comment) => {
    return sum + countTokens(comment.body);
  }, 0);

  let markdown = `# Pull Request #${pullRequestId} Comments\n\n`;
  markdown += `**Repository:** ${owner}/${repo}\n`;
  markdown += `**Total Comments:** ${comments.length}\n`;
  markdown += `**Total Tokens:** ${totalTokens.toLocaleString()}\n\n`;
  markdown += `---\n\n`;

  if (comments.length === 0) {
    markdown += `*No comments found for this pull request.*\n`;
    return markdown;
  }

  comments.forEach((comment, index) => {
    markdown += `## Comment ${index + 1}\n\n`;
    markdown += `**Author:** @${comment.user.login}\n`;
    markdown += `**Created:** ${new Date(comment.created_at).toLocaleString()}\n`;
    markdown += `**File:** \`${comment.path}\`\n`;

    // Line numbers
    if (comment.start_line && comment.line) {
      markdown += `**Lines:** ${comment.start_line}-${comment.line} (${comment.side || "RIGHT"} side)\n`;
    } else if (comment.line) {
      markdown += `**Line:** ${comment.line} (${comment.side || "RIGHT"} side)\n`;
    }

    markdown += `**[View on GitHub](${comment.html_url})**\n\n`;

    // Comment body
    markdown += `### Comment\n\n`;
    markdown += `${comment.body}\n\n`;

    if (index < comments.length - 1) {
      markdown += `---\n\n`;
    }
  });

  return markdown;
}

function formatCommentsWithReviews(
  owner: string,
  repo: string,
  pullRequestId: number,
  reviews: PullRequestReview[],
  comments: PullRequestReviewComment[],
  options: FormattingOptions
): string {
  // Calculate total tokens
  let totalTokens = 0;
  reviews.forEach(review => {
    if (review.body) totalTokens += countTokens(review.body);
  });
  comments.forEach(comment => {
    totalTokens += countTokens(comment.body);
  });

  let markdown = `# Pull Request #${pullRequestId} Comments\n\n`;
  markdown += `**Repository:** ${owner}/${repo}\n`;
  markdown += `**Total Reviews:** ${reviews.length}\n`;
  markdown += `**Total Comments:** ${comments.length}\n`;
  markdown += `**Total Tokens:** ${totalTokens.toLocaleString()}\n\n`;
  markdown += `---\n\n`;

  if (reviews.length === 0 && comments.length === 0) {
    markdown += `*No reviews or comments found for this pull request.*\n`;
    return markdown;
  }

  if (options.showThreading) {
    // Organize comments by threading
    const commentMap = new Map<number, PullRequestReviewComment>();
    const rootComments: PullRequestReviewComment[] = [];
    
    comments.forEach(comment => {
      commentMap.set(comment.id, comment);
      if (!comment.in_reply_to_id) {
        rootComments.push(comment);
      }
    });

    const getReplies = (commentId: number): PullRequestReviewComment[] => {
      return comments.filter(c => c.in_reply_to_id === commentId);
    };

    const formatCommentWithReplies = (comment: PullRequestReviewComment, depth = 0) => {
      const indent = "  ".repeat(depth);
      let output = "";
      
      if (depth === 0) {
        output += `## Comment ${comment.id}\n\n`;
      } else {
        output += `${indent}**↳ Reply**\n\n`;
      }
      
      output += `${indent}**Author:** @${comment.user.login}\n`;
      output += `${indent}**Created:** ${new Date(comment.created_at).toLocaleString()}\n`;
      output += `${indent}**File:** \`${comment.path}\`\n`;
      
      if (comment.start_line && comment.line) {
        output += `${indent}**Lines:** ${comment.start_line}-${comment.line} (${comment.side || "RIGHT"} side)\n`;
      } else if (comment.line) {
        output += `${indent}**Line:** ${comment.line} (${comment.side || "RIGHT"} side)\n`;
      }
      
      output += `${indent}**[View on GitHub](${comment.html_url})**\n\n`;
      output += `${indent}> ${comment.body.split('\n').join(`\n${indent}> `)}\n\n`;
      
      // Add replies
      const replies = getReplies(comment.id);
      replies.forEach(reply => {
        output += formatCommentWithReplies(reply, depth + 1);
      });
      
      return output;
    };

    // Group by review if including reviews
    if (options.includeReviews && reviews.length > 0) {
      const reviewMap = new Map<number, PullRequestReview>();
      reviews.forEach(review => reviewMap.set(review.id, review));
      
      // Group comments by review
      const reviewGroups = new Map<number | null, PullRequestReviewComment[]>();
      rootComments.forEach(comment => {
        const reviewId = comment.pull_request_review_id;
        if (!reviewGroups.has(reviewId)) {
          reviewGroups.set(reviewId, []);
        }
        reviewGroups.get(reviewId)!.push(comment);
      });
      
      let reviewIndex = 1;
      reviews.forEach(review => {
        markdown += `## Review ${reviewIndex++} - ${review.state}\n\n`;
        markdown += `**Author:** @${review.user.login}\n`;
        markdown += `**Submitted:** ${new Date(review.submitted_at).toLocaleString()}\n`;
        markdown += `**[View on GitHub](${review.html_url})**\n\n`;
        
        if (review.body) {
          markdown += `### Review Comment\n\n`;
          markdown += `${review.body}\n\n`;
        }
        
        const reviewComments = reviewGroups.get(review.id) || [];
        if (reviewComments.length > 0) {
          markdown += `### Code Comments (${reviewComments.length})\n\n`;
          reviewComments.forEach(comment => {
            markdown += formatCommentWithReplies(comment);
            markdown += `---\n\n`;
          });
        }
        
        markdown += `---\n\n`;
      });
      
      // Add orphaned comments (those without a review)
      const orphanedComments = reviewGroups.get(null) || [];
      if (orphanedComments.length > 0) {
        markdown += `## Standalone Comments\n\n`;
        orphanedComments.forEach(comment => {
          markdown += formatCommentWithReplies(comment);
          markdown += `---\n\n`;
        });
      }
    } else {
      // Just show comments with threading
      let commentIndex = 1;
      rootComments.forEach((comment, index) => {
        markdown += formatCommentWithReplies(comment);
        if (index < rootComments.length - 1) {
          markdown += `---\n\n`;
        }
      });
    }
  } else {
    // Simple flat view
    if (options.includeReviews && reviews.length > 0) {
      let reviewIndex = 1;
      reviews.forEach((review, index) => {
        markdown += `## Review ${reviewIndex++} - ${review.state}\n\n`;
        markdown += `**Author:** @${review.user.login}\n`;
        markdown += `**Submitted:** ${new Date(review.submitted_at).toLocaleString()}\n`;
        markdown += `**[View on GitHub](${review.html_url})**\n\n`;
        
        if (review.body) {
          markdown += `### Comment\n\n`;
          markdown += `${review.body}\n\n`;
        }
        
        if (index < reviews.length - 1 || comments.length > 0) {
          markdown += `---\n\n`;
        }
      });
    }
    
    // Add all comments (flat)
    comments.forEach((comment, index) => {
      markdown += `## Comment ${index + 1}\n\n`;
      markdown += `**Author:** @${comment.user.login}\n`;
      markdown += `**Created:** ${new Date(comment.created_at).toLocaleString()}\n`;
      markdown += `**File:** \`${comment.path}\`\n`;

      if (comment.start_line && comment.line) {
        markdown += `**Lines:** ${comment.start_line}-${comment.line} (${comment.side || "RIGHT"} side)\n`;
      } else if (comment.line) {
        markdown += `**Line:** ${comment.line} (${comment.side || "RIGHT"} side)\n`;
      }

      markdown += `**[View on GitHub](${comment.html_url})**\n\n`;
      markdown += `### Comment\n\n`;
      markdown += `${comment.body}\n\n`;

      if (index < comments.length - 1) {
        markdown += `---\n\n`;
      }
    });
  }

  return markdown;
}

function formatIssueAsMarkdown(
  owner: string,
  repo: string,
  issueNumber: number,
  issue: Issue | null,
  comments: IssueComment[]
): string {
  // Calculate tokens
  let totalTokens = 0;
  if (issue && issue.body) {
    totalTokens += countTokens(issue.body);
  }
  comments.forEach(comment => {
    totalTokens += countTokens(comment.body);
  });

  let markdown = `# Issue #${issueNumber} Comments\n\n`;
  markdown += `**Repository:** ${owner}/${repo}\n`;
  markdown += `**Total Comments:** ${comments.length}\n`;
  markdown += `**Total Tokens:** ${totalTokens.toLocaleString()}\n\n`;
  markdown += `---\n\n`;

  if (issue) {
    markdown += `## Issue Description\n\n`;
    markdown += `**Title:** ${issue.title}\n`;
    markdown += `**Author:** @${issue.user.login}\n`;
    markdown += `**Created:** ${new Date(issue.created_at).toLocaleString()}\n`;
    markdown += `**State:** ${issue.state}\n`;
    markdown += `**[View on GitHub](${issue.html_url})**\n\n`;
    markdown += `### Description\n\n`;
    markdown += `${issue.body || "*No description*"}\n\n`;
    markdown += `---\n\n`;
  }

  if (comments.length === 0 && !issue) {
     markdown += `*No comments found for this issue.*\n`;
     return markdown;
  }

  comments.forEach((comment, index) => {
    markdown += `## Comment ${index + 1}\n\n`;
    markdown += `**Author:** @${comment.user.login}\n`;
    markdown += `**Created:** ${new Date(comment.created_at).toLocaleString()}\n`;
    markdown += `**[View on GitHub](${comment.html_url})**\n\n`;

    markdown += `### Comment\n\n`;
    markdown += `${comment.body}\n\n`;

    if (index < comments.length - 1) {
      markdown += `---\n\n`;
    }
  });

  return markdown;
}

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.status(200).send("OK");
});

// Root endpoint - Redirect to GitHub repo
app.get("/", (req: Request, res: Response) => {
  res.redirect(302, "https://github.com/R44VC0RP/gitcom.dev");
});

// Handler function for PR comments
async function handlePRComments(
  owner: string,
  repo: string,
  pullRequestId: string,
  commentNumber: string | undefined,
  token: string,
  options: FormattingOptions,
  res: Response
) {
  // Validate required parameters
  if (!owner || !repo || !pullRequestId) {
    const errorMarkdown = `# Error 400\n\nMissing required parameters.\n\nExpected: /:owner/:repo/pull/:pullRequestId`;
    return res.status(400)
      .set("Content-Type", "text/markdown; charset=utf-8")
      .send(errorMarkdown);
  }
  
  // Validate pullRequestId is a number
  const prId = parseInt(pullRequestId, 10);
  if (isNaN(prId)) {
    const errorMarkdown = `# Error 400\n\nInvalid pull request ID.\n\n**Received:** ${pullRequestId}\n\nPull request ID must be a number.`;
    return res.status(400)
      .set("Content-Type", "text/markdown; charset=utf-8")
      .send(errorMarkdown);
  }

  // Validate commentNumber if provided
  let commentNum: number | null = null;
  if (commentNumber) {
    commentNum = parseInt(commentNumber, 10);
    if (isNaN(commentNum)) {
      const errorMarkdown = `# Error 400\n\nInvalid comment number.\n\n**Received:** ${commentNumber}\n\nComment number must be a number.`;
      return res.status(400)
        .set("Content-Type", "text/markdown; charset=utf-8")
        .send(errorMarkdown);
    }
  }

  if (!token) {
    const errorMarkdown = `# Error 401\n\nMissing GitHub token.\n\n**Options:**\n- Set \`GITHUB_TOKEN\` environment variable\n- Pass token as query parameter: \`?token=your_token\``;
    return res.status(401)
      .set("Content-Type", "text/markdown; charset=utf-8")
      .send(errorMarkdown);
  }

  try {
    const client = new GitHubClient(token);
    
    // Fetch reviews and comments if advanced features are needed
    if (options.includeReviews || options.showThreading) {
      const { reviews, comments } = await client.getPullRequestReviewsAndComments(owner, repo, prId);
      
      let filteredComments = comments;
      
      // Note: GitHub API doesn't directly expose resolved status in the comments endpoint
      // This would require fetching review threads separately, which is not currently implemented
      // For now, we'll note this limitation in the documentation
      
      // Filter by comment number if provided
      if (commentNum !== null) {
        if (commentNum < 1 || commentNum > filteredComments.length) {
          const errorMarkdown = `# Error 404\n\nComment not found.\n\n**Comment Number:** ${commentNum}\n**Pull Request:** #${prId}\n**Total Comments:** ${filteredComments.length}\n\nComment number must be between 1 and ${filteredComments.length}.`;
          return res.status(404)
            .set("Content-Type", "text/markdown; charset=utf-8")
            .send(errorMarkdown);
        }
        // Get the specific comment by index (commentNum - 1 since arrays are 0-indexed)
        filteredComments = [filteredComments[commentNum - 1]!];
      }
      
      const markdown = formatCommentsWithReviews(owner, repo, prId, reviews, filteredComments, options);
      
      return res.status(200)
        .set("Content-Type", "text/markdown; charset=utf-8")
        .send(markdown);
    } else {
      // Simple mode: just fetch comments
      let comments = await client.getPullRequestComments(owner, repo, prId);

      // Filter by comment number if provided
      if (commentNum !== null) {
        if (commentNum < 1 || commentNum > comments.length) {
          const errorMarkdown = `# Error 404\n\nComment not found.\n\n**Comment Number:** ${commentNum}\n**Pull Request:** #${prId}\n**Total Comments:** ${comments.length}\n\nComment number must be between 1 and ${comments.length}.`;
          return res.status(404)
            .set("Content-Type", "text/markdown; charset=utf-8")
            .send(errorMarkdown);
        }
        // Get the specific comment by index (commentNum - 1 since arrays are 0-indexed)
        comments = [comments[commentNum - 1]!];
      }

      const markdown = formatCommentsAsMarkdown(owner, repo, prId, comments);

      return res.status(200)
        .set("Content-Type", "text/markdown; charset=utf-8")
        .send(markdown);
    }
  } catch (error) {
    console.error("Error fetching PR comments:", error);
    
    const errorMarkdown = `# Error\n\nFailed to fetch pull request comments.\n\n**Details:** ${error instanceof Error ? error.message : String(error)}`;
    
    return res.status(500)
      .set("Content-Type", "text/markdown; charset=utf-8")
      .send(errorMarkdown);
  }
}

// Handler function for Issue comments
async function handleIssueComments(
  owner: string,
  repo: string,
  issueNumber: string,
  commentNumber: string | undefined,
  token: string,
  res: Response
) {
  // Validate required parameters
  if (!owner || !repo || !issueNumber) {
    const errorMarkdown = `# Error 400\n\nMissing required parameters.\n\nExpected: /:owner/:repo/issues/:issueNumber`;
    return res.status(400)
      .set("Content-Type", "text/markdown; charset=utf-8")
      .send(errorMarkdown);
  }

  // Validate issueNumber is a number
  const issueNum = parseInt(issueNumber, 10);
  if (isNaN(issueNum)) {
    const errorMarkdown = `# Error 400\n\nInvalid issue number.\n\n**Received:** ${issueNumber}\n\nIssue number must be a number.`;
    return res.status(400)
      .set("Content-Type", "text/markdown; charset=utf-8")
      .send(errorMarkdown);
  }

  // Validate commentNumber if provided
  let commentNum: number | null = null;
  if (commentNumber) {
    commentNum = parseInt(commentNumber, 10);
    if (isNaN(commentNum)) {
      const errorMarkdown = `# Error 400\n\nInvalid comment number.\n\n**Received:** ${commentNumber}\n\nComment number must be a number.`;
      return res.status(400)
        .set("Content-Type", "text/markdown; charset=utf-8")
        .send(errorMarkdown);
    }
  }

  if (!token) {
    const errorMarkdown = `# Error 401\n\nMissing GitHub token.\n\n**Options:**\n- Set \`GITHUB_TOKEN\` environment variable\n- Pass token as query parameter: \`?token=your_token\``;
    return res.status(401)
      .set("Content-Type", "text/markdown; charset=utf-8")
      .send(errorMarkdown);
  }

  try {
    const client = new GitHubClient(token);
    let comments = await client.getIssueComments(owner, repo, issueNum);
    let issue: Issue | null = null;

    if (commentNum !== null) {
      if (commentNum < 1 || commentNum > comments.length) {
        const errorMarkdown = `# Error 404\n\nComment not found.\n\n**Comment Number:** ${commentNum}\n**Issue:** #${issueNum}\n**Total Comments:** ${comments.length}\n\nComment number must be between 1 and ${comments.length}.`;
        return res.status(404)
          .set("Content-Type", "text/markdown; charset=utf-8")
          .send(errorMarkdown);
      }
      comments = [comments[commentNum - 1]!];
    } else {
        // Fetch issue details only if not fetching a specific comment (or maybe fetch it anyway?)
        // Fetching it anyway to include in the full view
        issue = await client.getIssue(owner, repo, issueNum);
    }

    const markdown = formatIssueAsMarkdown(owner, repo, issueNum, issue, comments);

    return res.status(200)
      .set("Content-Type", "text/markdown; charset=utf-8")
      .send(markdown);

  } catch (error) {
    console.error("Error fetching issue comments:", error);

    const errorMarkdown = `# Error\n\nFailed to fetch issue comments.\n\n**Details:** ${error instanceof Error ? error.message : String(error)}`;

    return res.status(500)
      .set("Content-Type", "text/markdown; charset=utf-8")
      .send(errorMarkdown);
  }
}

// Route: Get specific issue comment by number
app.get("/:owner/:repo/issues/:issueNumber/:commentNumber", async (req: Request, res: Response) => {
  const { owner, repo, issueNumber, commentNumber } = req.params;
  const token = (req.query.token as string) || process.env.GITHUB_TOKEN || "";
  return handleIssueComments(owner, repo, issueNumber, commentNumber, token, res);
});

// Route: Get all issue comments
app.get("/:owner/:repo/issues/:issueNumber", async (req: Request, res: Response) => {
  const { owner, repo, issueNumber } = req.params;
  const token = (req.query.token as string) || process.env.GITHUB_TOKEN || "";
  return handleIssueComments(owner, repo, issueNumber, undefined, token, res);
});

// Route: Get specific comment by number
app.get("/:owner/:repo/pull/:pullRequestId/:commentNumber", async (req: Request, res: Response) => {
  const { owner, repo, pullRequestId, commentNumber } = req.params;
  
  if (!owner || !repo || !pullRequestId || !commentNumber) {
    const errorMarkdown = `# Error 400\n\nMissing required parameters.`;
    return res.status(400)
      .set("Content-Type", "text/markdown; charset=utf-8")
      .send(errorMarkdown);
  }
  
  const token = (req.query.token as string) || process.env.GITHUB_TOKEN || "";
  
  // Parse query parameters
  const options: FormattingOptions = {
    includeReviews: req.query.include_reviews === "true",
    showThreading: req.query.show_threading === "true",
    resolvedFilter: req.query.resolved as "true" | "false" | undefined,
  };
  
  return handlePRComments(owner, repo, pullRequestId, commentNumber, token, options, res);
});

// Route: Get all comments
app.get("/:owner/:repo/pull/:pullRequestId", async (req: Request, res: Response) => {
  const { owner, repo, pullRequestId } = req.params;
  
  if (!owner || !repo || !pullRequestId) {
    const errorMarkdown = `# Error 400\n\nMissing required parameters.`;
    return res.status(400)
      .set("Content-Type", "text/markdown; charset=utf-8")
      .send(errorMarkdown);
  }
  
  const token = (req.query.token as string) || process.env.GITHUB_TOKEN || "";
  
  // Parse query parameters
  const options: FormattingOptions = {
    includeReviews: req.query.include_reviews === "true",
    showThreading: req.query.show_threading === "true",
    resolvedFilter: req.query.resolved as "true" | "false" | undefined,
  };
  
  return handlePRComments(owner, repo, pullRequestId, undefined, token, options, res);
});

// 404 handler for all other routes
app.use((req: Request, res: Response) => {
  const errorMarkdown = `# Error 404\n\nRoute not found.\n\n**Expected formats:**\n- \`/:repoOwner/:repoName/pull/:id\` - Get all comments\n- \`/:repoOwner/:repoName/pull/:id/:commentNumber\` - Get specific comment by number (1, 2, 3...)\n- \`/:repoOwner/:repoName/issues/:id\` - Get all issue comments\n- \`/:repoOwner/:repoName/issues/:id/:commentNumber\` - Get specific issue comment by number (1, 2, 3...)\n\n**Examples:**\n- \`/inboundemail/inbound/pull/142\` - Get all comments\n- \`/inboundemail/inbound/pull/142/5\` - Get the 5th comment`;
  
  res.status(404)
    .set("Content-Type", "text/markdown; charset=utf-8")
    .send(errorMarkdown);
});

// Only start server if not in Vercel environment and not in test environment
if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`\nExamples:`);
    console.log(`  All comments: http://localhost:${PORT}/inboundemail/inbound/pull/142`);
    console.log(`  Single comment: http://localhost:${PORT}/inboundemail/inbound/pull/142/5`);
    console.log(`  All issue comments: http://localhost:${PORT}/inboundemail/inbound/issues/142`);
  });
}

// Export for Vercel
export default app;
