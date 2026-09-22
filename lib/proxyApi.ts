import { supabase } from './supabase';

// Proxy links (SPEC.md §1/§2.1, migration 0017): a caregiver or family
// member who may book and track rides for a rider.
//
// The rider invites by email; the invitee accepts, which stamps their user id
// on the link. Storing the email rather than resolving it to an account means
// this can't be used to find out which addresses have accounts here.

export type ProxyLinkStatus = 'pending' | 'accepted' | 'revoked';

export type ProxyLink = {
  id: string;
  riderId: string;
  proxyEmail: string;
  proxyId: string | null;
  status: ProxyLinkStatus;
  createdAt: string;
  acceptedAt: string | null;
};

function mapRow(r: any): ProxyLink {
  return {
    id: r.id,
    riderId: r.rider_id,
    proxyEmail: r.proxy_email,
    proxyId: r.proxy_id,
    status: r.status,
    createdAt: r.created_at,
    acceptedAt: r.accepted_at,
  };
}

// Rider side: everyone I've invited, and where each invite stands.
export async function fetchMyProxies(riderId: string): Promise<{ data: ProxyLink[]; error: string | null }> {
  const { data, error } = await supabase
    .from('rider_proxies')
    .select('*')
    .eq('rider_id', riderId)
    .neq('status', 'revoked')
    .order('created_at');
  if (error) return { data: [], error: error.message };
  return { data: (data ?? []).map(mapRow), error: null };
}

export async function inviteProxy(riderId: string, email: string): Promise<{ data: ProxyLink | null; error: string | null }> {
  const clean = email.trim().toLowerCase();
  if (!clean.includes('@')) return { data: null, error: 'Enter a valid email address.' };
  const { data, error } = await supabase
    .from('rider_proxies')
    .insert({ rider_id: riderId, proxy_email: clean, status: 'pending' })
    .select('*')
    .single();
  // 23505 = the (rider_id, proxy_email) unique index.
  if (error?.code === '23505') return { data: null, error: "You've already invited that person." };
  if (error) return { data: null, error: error.message };
  return { data: mapRow(data), error: null };
}

// Rider side: take someone's access away. Kept as a row (not deleted) so the
// same person can be re-invited without confusion about what happened.
export async function revokeProxy(linkId: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase.from('rider_proxies').update({ status: 'revoked' }).eq('id', linkId).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "That link is no longer yours to change." };
  return { error: null };
}

// Proxy side: invites addressed to my email, plus riders I already act for.
// RLS decides what comes back — the query is the same either way.
export async function fetchLinksForMe(): Promise<{ data: ProxyLink[]; error: string | null }> {
  const { data, error } = await supabase.from('rider_proxies').select('*').neq('status', 'revoked').order('created_at');
  if (error) return { data: [], error: error.message };
  return { data: (data ?? []).map(mapRow), error: null };
}

// Accepting stamps my id on the link: from here on the rider sees a real
// person rather than an unanswered invite.
export async function acceptProxyInvite(linkId: string, myUserId: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from('rider_proxies')
    .update({ proxy_id: myUserId, status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', linkId)
    .select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'That invite is no longer available.' };
  return { error: null };
}

// Declining an invite, or stepping down from one already accepted. Same row,
// same end state — the rider sees it's no longer active either way.
export async function leaveProxyLink(linkId: string, myUserId: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from('rider_proxies')
    .update({ proxy_id: myUserId, status: 'revoked' })
    .eq('id', linkId)
    .select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'That invite is no longer available.' };
  return { error: null };
}
