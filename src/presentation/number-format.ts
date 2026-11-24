export type NumberFormat = 'scientific' | 'engineering' | 'suffix' | 'full';

const SHORT_SCALE = [
  'K','M','B','T','Qa','Qi','Sx','Sp','Oc','No','Dc',
  'UDc','DDc','TDc','QaDc','QiDc','SxDc','SpDc','OcDc','NoDc',
  'Vg','UVg','DVg','TVg','QaVg','QiVg','SxVg','SpVg','OcVg','NoVg','Tg'
] as const;

export function formatNumber(value:number,digits=2,format:NumberFormat='suffix',locale='ru-RU'):string{
  if(!Number.isFinite(value))return '—';
  if(value===0)return '0';
  const absolute=Math.abs(value);
  if(format==='scientific')return value.toExponential(digits);
  if(format==='engineering'){
    const exponent=Math.floor(Math.log10(absolute)/3)*3;
    const mantissa=value/Math.pow(10,exponent);
    return mantissa.toFixed(digits)+'e'+(exponent>=0?'+':'')+exponent;
  }
  if(format==='full')return new Intl.NumberFormat(locale,{maximumFractionDigits:digits}).format(value);
  if(absolute<1000)return new Intl.NumberFormat(locale,{maximumFractionDigits:digits}).format(value);
  const group=Math.floor(Math.log10(absolute)/3);
  const suffix=SHORT_SCALE[group-1];
  if(!suffix)return value.toExponential(digits);
  const scaled=value/Math.pow(1000,group);
  return scaled.toFixed(digits)+suffix;
}
