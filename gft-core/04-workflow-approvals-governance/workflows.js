// GFT Core — workflow engine boundary.
export function createWorkflow(type,subject){return {workflowId:crypto.randomUUID(),type,subject,status:"OPEN",createdAt:new Date().toISOString()}}
