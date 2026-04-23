export function createPlan(task) {
  return `
TASK: ${task}

Create a detailed, structured execution plan.

FORMAT:
1. Objective
2. Key Steps
3. Expected Output
4. Quality Criteria

Provide the plan now.
`;
}