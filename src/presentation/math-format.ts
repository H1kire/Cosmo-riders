/** Presentation adapter only: return TeX for KaTeX. Never parse TeX back into physics. */
export function formatScientific(value,significantDigits=6){
 if(Number.isNaN(value))throw new TypeError('value must not be NaN.');
 if(!Number.isFinite(value))return value<0?'-\\infty':'\\infty';
 if(!Number.isInteger(significantDigits)||significantDigits<1||significantDigits>15)throw new RangeError('significantDigits must be between 1 and 15.');
 if(value===0)return '0';
 const [coefficient,exponent]=value.toExponential(significantDigits-1).split('e');
 return Number(coefficient)+'\\times 10^{'+Number(exponent)+'}';
}
export function toTeXNumber(value,significantDigits=6){if(Number.isNaN(value))throw new TypeError('value must not be NaN.');if(!Number.isFinite(value))return value<0?'-\\infty':'\\infty';return formatScientific(value,significantDigits);}