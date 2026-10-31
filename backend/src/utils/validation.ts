/**
 * Valida o formato de um e-mail.
 */
export function validateEmail(email: string): boolean {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Valida o formato de um celular brasileiro (formato DDD + 9 + 8 dígitos).
 * Deve conter 11 dígitos numéricos após limpeza de caracteres especiais.
 */
export function validateCelular(phone: string): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  
  // O terceiro dígito deve ser 9 (celular no Brasil)
  if (digits[2] !== '9') return false;
  
  // DDDs válidos são entre 11 e 99
  const ddd = parseInt(digits.substring(0, 2), 10);
  if (ddd < 11 || ddd > 99) return false;
  
  return true;
}

/**
 * Valida um CPF brasileiro de forma matemática.
 */
export function validateCPF(cpf: string): boolean {
  if (!cpf) return false;
  const cleanCpf = cpf.replace(/\D/g, '');
  if (cleanCpf.length !== 11) return false;

  // Elimina CPFs conhecidos inválidos
  if (/^(\d)\1{10}$/.test(cleanCpf)) return false;

  // Valida 1o dígito
  let add = 0;
  for (let i = 0; i < 9; i++) {
    add += parseInt(cleanCpf.charAt(i), 10) * (10 - i);
  }
  let rev = 11 - (add % 11);
  if (rev === 10 || rev === 11) {
    rev = 0;
  }
  if (rev !== parseInt(cleanCpf.charAt(9), 10)) {
    return false;
  }

  // Valida 2o dígito
  add = 0;
  for (let i = 0; i < 10; i++) {
    add += parseInt(cleanCpf.charAt(i), 10) * (11 - i);
  }
  rev = 11 - (add % 11);
  if (rev === 10 || rev === 11) {
    rev = 0;
  }
  if (rev !== parseInt(cleanCpf.charAt(10), 10)) {
    return false;
  }

  return true;
}

/**
 * Valida um CNPJ brasileiro de forma matemática.
 */
export function validateCNPJ(cnpj: string): boolean {
  if (!cnpj) return false;
  const cleanCnpj = cnpj.replace(/\D/g, '');
  if (cleanCnpj.length !== 14) return false;

  // Elimina CNPJs conhecidos inválidos
  if (/^(\d)\1{13}$/.test(cleanCnpj)) return false;

  // Valida 1o dígito
  let tamanho = cleanCnpj.length - 2;
  let numeros = cleanCnpj.substring(0, tamanho);
  const digitos = cleanCnpj.substring(tamanho);
  let soma = 0;
  let pos = tamanho - 7;
  for (let i = tamanho; i >= 1; i--) {
    soma += parseInt(numeros.charAt(tamanho - i), 10) * pos--;
    if (pos < 2) pos = 9;
  }
  let resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  if (resultado !== parseInt(digitos.charAt(0), 10)) return false;

  // Valida 2o dígito
  tamanho = tamanho + 1;
  numeros = cleanCnpj.substring(0, tamanho);
  soma = 0;
  pos = tamanho - 7;
  for (let i = tamanho; i >= 1; i--) {
    soma += parseInt(numeros.charAt(tamanho - i), 10) * pos--;
    if (pos < 2) pos = 9;
  }
  resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  if (resultado !== parseInt(digitos.charAt(1), 10)) return false;

  return true;
}

/**
 * Valida CPF ou CNPJ dependendo do número de dígitos.
 */
export function validateCPFOrCNPJ(doc: string): boolean {
  if (!doc) return false;
  const cleanDoc = doc.replace(/\D/g, '');
  if (cleanDoc.length === 11) {
    return validateCPF(cleanDoc);
  } else if (cleanDoc.length === 14) {
    return validateCNPJ(cleanDoc);
  }
  return false;
}

