export type ActionRequest = {
  id: number
  action: string
  input: Record<string, any>
}

export type ActionResponse = {
  id: number
  content: unknown
  json: boolean
}
