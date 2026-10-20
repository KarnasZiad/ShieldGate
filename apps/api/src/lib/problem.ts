/**
 * Error carrying an RFC 9457 "problem details" response. Titles and details are written for API
 * consumers: they never contain stack traces, SQL or secrets (threat I3).
 */
export class HttpProblem extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly extensions: Record<string, unknown> = {},
  ) {
    super(detail ?? title);
    this.name = 'HttpProblem';
  }
}

export const problems = {
  badRequest: (detail?: string) => new HttpProblem(400, 'Bad Request', detail),
  unauthorized: (detail?: string) => new HttpProblem(401, 'Unauthorized', detail),
  forbidden: (detail?: string) => new HttpProblem(403, 'Forbidden', detail),
  notFound: (detail?: string) => new HttpProblem(404, 'Not Found', detail),
  conflict: (detail?: string) => new HttpProblem(409, 'Conflict', detail),
  unprocessable: (detail?: string, extensions?: Record<string, unknown>) =>
    new HttpProblem(422, 'Unprocessable Content', detail, extensions),
  tooManyRequests: (detail?: string) => new HttpProblem(429, 'Too Many Requests', detail),
};
