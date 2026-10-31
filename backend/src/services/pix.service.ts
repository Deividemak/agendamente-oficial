export interface PixPayload {
  pixCopiaCola: string;
  qrCodeUrl: string;
  checkoutId: string;
  valor: number;
}

/**
 * Simula a geração de um checkout Pix EMV (Copia e Cola) e QR Code.
 */
export function generatePixCheckout(
  pixChave: string,
  valor: number,
  clienteNome: string,
  checkoutId: string
): PixPayload {
  // Limpa caracteres especiais do nome e valor para o payload Pix
  const nomeVendedorClean = clienteNome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/[^A-Za-z0-9 ]/g, '') // Remove caracteres especiais
    .substring(0, 15)
    .toUpperCase();

  const valorString = valor.toFixed(2);
  
  // Estrutura simplificada de um payload Pix padrão (EMV)
  // br.gov.bcb.pix -> indicador do arranjo Pix
  const merchantAccountInfo = `0014br.gov.bcb.pix01${String(pixChave.length).padStart(2, '0')}${pixChave}`;
  // Limita o checkoutId a no máximo 25 caracteres para caber no limite do TxID (especificação do Banco Central)
  const txid = checkoutId.substring(0, 25);
  const txidLength = txid.length;
  const subField05 = `05${String(txidLength).padStart(2, '0')}${txid}`;
  const addDataField = `62${String(subField05.length).padStart(2, '0')}${subField05}`;
  
  // Formatando partes do Payload EMV
  const payloadParts = {
    payloadFormat: '000201',
    merchantAccount: `26${String(merchantAccountInfo.length).padStart(2, '0')}${merchantAccountInfo}`,
    categoryCode: '52040000',
    currencyCode: '5303986', // ISO 4217 - 986 (BRL)
    transactionAmount: `54${String(valorString.length).padStart(2, '0')}${valorString}`,
    countryCode: '5802BR',
    merchantName: `59${String(nomeVendedorClean.length).padStart(2, '0')}${nomeVendedorClean}`,
    merchantCity: '6009SAO PAULO',
    addDataField, // Campo livre contendo o ID do checkout dinamicamente formatado
  };

  const payloadSemCRC = 
    payloadParts.payloadFormat +
    payloadParts.merchantAccount +
    payloadParts.categoryCode +
    payloadParts.currencyCode +
    payloadParts.transactionAmount +
    payloadParts.countryCode +
    payloadParts.merchantName +
    payloadParts.merchantCity +
    payloadParts.addDataField +
    '6304'; // Indica início do CRC16

  // Calcula o CRC16 CCITT
  const crc = calculateCRC16(payloadSemCRC);
  const pixCopiaCola = payloadSemCRC + crc.toUpperCase();

  // URL pública para renderização do QR Code a partir do payload Copia e Cola
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(
    pixCopiaCola
  )}`;

  return {
    pixCopiaCola,
    qrCodeUrl,
    checkoutId,
    valor,
  };
}

/**
 * Função para calcular CRC16 CCITT (Polinômio 0x1021, Valor inicial 0xFFFF)
 */
function calculateCRC16(str: string): string {
  let crc = 0xffff;
  const polynomial = 0x1021;

  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    for (let bit = 0; bit < 8; bit++) {
      const bitOn = ((charCode >> (7 - bit)) & 1) === 1;
      const crcBitOn = ((crc >> 15) & 1) === 1;
      crc <<= 1;
      if (bitOn !== crcBitOn) {
        crc ^= polynomial;
      }
    }
  }

  crc &= 0xffff;
  return crc.toString(16).padStart(4, '0');
}
