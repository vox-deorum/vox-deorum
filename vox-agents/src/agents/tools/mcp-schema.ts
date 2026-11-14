/**
 * Return an MCP input schema with fields supplied by autoComplete metadata removed.
 * The returned schema and its edited property collections are copies, so MCP definitions stay intact.
 */
export function filterAutoCompleteSchema(
  inputSchema: Record<string, any>,
  autoComplete?: string[]
): Record<string, any> {
  const inputProperties = inputSchema.properties;
  const schema = { ...inputSchema };
  if (inputProperties && autoComplete) {
    const properties = { ...inputProperties };
    for (const field of autoComplete) delete properties[field];
    schema.properties = properties;

    if (schema.required) {
      schema.required = schema.required.filter((field: string) => !autoComplete.includes(field));
    }
  }
  return schema;
}
