import { describe, expect, it } from 'vitest';
import { companyParts } from './companyLine';

describe('companyParts', () => {
  it('reads the company name and kennitala from the wp-admin line', () => {
    expect(companyParts('Músík og Sport ehf. Dalshraun 10, 220 Hafnarfjörður, kennitala 710303-2310 Allur réttur áskilinn 2025 ©')).toEqual({
      name: 'Músík og Sport ehf.',
      nationalId: '710303-2310',
    });
    expect(companyParts('Músík og Sport ehf. Dalshraun 10, 220 Hafnarfjörður, kennitala 710303-2310')).toEqual({
      name: 'Músík og Sport ehf.',
      nationalId: '710303-2310',
    });
  });
  it('reads "kt." and a kennitala without the dash', () => {
    expect(companyParts('Músík og Sport hf. kt. 7103032310')).toEqual({ name: 'Músík og Sport hf.', nationalId: '710303-2310' });
  });
  it('gives up (null) without a company form or a kennitala', () => {
    expect(companyParts('Allur réttur áskilinn')).toBeNull();
    expect(companyParts('Músík og Sport ehf. Dalshraun 10')).toBeNull();
    expect(companyParts('')).toBeNull();
  });
});
