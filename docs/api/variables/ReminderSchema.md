[**anothertodo API**](../README.md)

***

[anothertodo API](../README.md) / ReminderSchema

# Variable: ReminderSchema

> `const` **ReminderSchema**: `ZodObject`\<\{ `at`: `ZodString`; `attempts`: `ZodOptional`\<`ZodNumber`\>; `dead`: `ZodDefault`\<`ZodBoolean`\>; `fired`: `ZodDefault`\<`ZodBoolean`\>; `hooks`: `ZodDefault`\<`ZodArray`\<`ZodString`, `"many"`\>\>; `id`: `ZodOptional`\<`ZodString`\>; `leaseOwner`: `ZodOptional`\<`ZodString`\>; `leaseUntil`: `ZodOptional`\<`ZodString`\>; \}, `"strip"`, `ZodTypeAny`, \{ `at`: `string`; `attempts?`: `number`; `dead`: `boolean`; `fired`: `boolean`; `hooks`: `string`[]; `id?`: `string`; `leaseOwner?`: `string`; `leaseUntil?`: `string`; \}, \{ `at`: `string`; `attempts?`: `number`; `dead?`: `boolean`; `fired?`: `boolean`; `hooks?`: `string`[]; `id?`: `string`; `leaseOwner?`: `string`; `leaseUntil?`: `string`; \}\>
