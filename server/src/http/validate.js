// Shared request validation with Zod. Every route validates its params, query and body;
// a part a route does not declare must be empty, and unknown fields are always rejected.
import { z } from 'zod';

const EMPTY = z.strictObject({});

function plainMessage(error) {
  const issue = error.issues[0];
  if (issue.code === 'unrecognized_keys') {
    return `Unknown field${issue.keys.length > 1 ? 's' : ''}: ${issue.keys.join(', ')}`;
  }
  return issue.message;
}

export function validate({ params = EMPTY, query = EMPTY, body = EMPTY }) {
  return (req, res, next) => {
    req.valid = {};
    for (const [part, schema] of [['params', params], ['query', query], ['body', body]]) {
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) return res.status(400).json({ error: plainMessage(result.error) });
      req.valid[part] = result.data;
    }
    next();
  };
}
