/** CPF: só dígitos, com os dois dígitos verificadores conferidos (não consulta a Receita). */
export function normalizeCpf(value: string) {
    return value.replace(/\D/g, '')
}

export function isValidCpf(value: string) {
    const cpf = normalizeCpf(value)
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false
    const digit = (length: number) => {
        let sum = 0
        for (let i = 0; i < length; i++) sum += Number(cpf[i]) * (length + 1 - i)
        const rest = (sum * 10) % 11
        return rest === 10 ? 0 : rest
    }
    return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10])
}

/** 123.456.789-09 */
export function formatCpf(value: string) {
    const cpf = normalizeCpf(value)
    return cpf.length === 11 ? `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` : value
}

/** ***.456.789-** — para mostrar em páginas públicas. */
export function maskCpf(value: string) {
    const cpf = normalizeCpf(value)
    return cpf.length === 11 ? `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**` : '***'
}
