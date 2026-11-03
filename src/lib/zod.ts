import { z } from 'zod'

type WithoutDefaults<T extends z.ZodRawShape> = { [K in keyof T]: T[K] extends z.ZodDefault<infer Inner> ? Inner : T[K] }

/**
 * Esquema de edição (PATCH) a partir do de criação: todos os campos opcionais e SEM os valores padrão.
 * No zod 4 o `.default()` vale mesmo dentro de `.partial()`; sem isto, um PATCH que não manda o campo
 * gravaria o padrão por cima do valor salvo (ex.: pacotes da proposta zerados, status voltando para ABERTA).
 */
export function patchSchemaOf<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
    const shape = Object.fromEntries(
        Object.entries(schema.shape).map(([key, field]) => [key, field instanceof z.ZodDefault ? field.unwrap() : field])
    ) as WithoutDefaults<T>
    return z.object(shape).partial()
}
