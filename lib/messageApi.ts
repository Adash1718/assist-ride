import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

// Per-ride message thread (migration 0022) — how the rider and driver reach
// each other, instead of swapping phone numbers. RLS decides who may read and
// send; nothing here is the security boundary.

export type RideMessage = {
  id: string;
  rideId: string;
  senderId: string;
  body: string;
  createdAt: string;
};

function mapMessage(row: any): RideMessage {
  return {
    id: row.id,
    rideId: row.ride_id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

export const MESSAGE_MAX_LENGTH = 1000;

export async function fetchRideMessages(rideId: string): Promise<{ data: RideMessage[]; error: string | null }> {
  const { data, error } = await supabase
    .from('ride_messages')
    .select('*')
    .eq('ride_id', rideId)
    .order('created_at');
  if (error) return { data: [], error: error.message };
  return { data: (data ?? []).map(mapMessage), error: null };
}

export async function sendRideMessage(
  rideId: string,
  senderId: string,
  body: string
): Promise<{ data: RideMessage | null; error: string | null }> {
  const trimmed = body.trim();
  if (trimmed === '') return { data: null, error: null }; // nothing to send, not an error
  const { data, error } = await supabase
    .from('ride_messages')
    .insert({ ride_id: rideId, sender_id: senderId, body: trimmed.slice(0, MESSAGE_MAX_LENGTH) })
    .select('*')
    .single();
  // 42501 here means the insert policy refused: either this ride ended while
  // the screen was open, or the sender is no longer on it (a driver who
  // handed it back). Both read the same way to the person typing.
  if (error?.code === '42501') {
    return { data: null, error: "This ride has ended, so messages can't be sent any more." };
  }
  if (error) return { data: null, error: error.message };
  return { data: mapMessage(data), error: null };
}

// Live delivery. Both sides keep passing the SELECT policy for the whole ride
// and afterwards, so unlike the offer screen (see CLAUDE.md on the Realtime
// blind spot) there's no visibility cliff to poll around here.
export function subscribeToRideMessages(rideId: string, onMessage: (message: RideMessage) => void): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`ride-messages-${rideId}-${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'ride_messages', filter: `ride_id=eq.${rideId}` },
      (payload) => onMessage(mapMessage(payload.new))
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
