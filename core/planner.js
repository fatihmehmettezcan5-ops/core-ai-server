export function createPlan(task) {
  return `
Task:
${task}

Create a structured plan.

Output format:

PLAN:
1.
2.
3.

REQUIRED_TOOL_TYPE:
- reasoning
- execution
- file_generation
- web
- image
`;
}