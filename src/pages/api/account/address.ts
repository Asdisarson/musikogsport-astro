import type { APIRoute } from 'astro';
import { currentUser } from '../../../lib/auth';
import { updateCustomer } from '../../../lib/account';
import { addressFromForm, type Address } from '../../../lib/accountFormat';
import { sameOrigin } from '../../../lib/http';

export const prerender = false;

// /min-sida/edit-address/<billing|shipping>/ — writes only the signed-in customer's own address.
export const POST: APIRoute = async ({ request, cookies, url, redirect }) => {
  if (!sameOrigin(request, url)) return new Response('Forbidden', { status: 403 });
  const user = await currentUser(cookies);
  if (!user) return redirect('/min-sida/', 303);
  const form = await request.formData().catch(() => null);
  const type = form?.get('type') === 'shipping' ? 'shipping' : 'billing';
  if (!form) return redirect(`/min-sida/edit-address/${type}/?error=1`, 303);
  const address = addressFromForm(form, type);
  const required: (keyof Address)[] = ['first_name', 'last_name', 'address_1', 'postcode', 'city', ...(type === 'billing' ? (['phone', 'email'] as const) : [])];
  if (required.some((f) => !address[f])) return redirect(`/min-sida/edit-address/${type}/?error=required`, 303);
  if (type === 'billing' && !/^\S+@\S+\.\S+$/.test(address.email ?? '')) return redirect(`/min-sida/edit-address/${type}/?error=email`, 303);
  try {
    await updateCustomer(user.id, { [type]: address });
  } catch {
    return redirect(`/min-sida/edit-address/${type}/?error=1`, 303);
  }
  return redirect('/min-sida/edit-address/?saved=1', 303);
};
