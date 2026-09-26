// GFT Core — task engine boundary.
export function createTask(title,assignee=null){return {taskId:crypto.randomUUID(),title,assignee,status:"OPEN"}}
