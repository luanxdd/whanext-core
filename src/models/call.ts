export type CallStatus = 'offer' | 'ringing' | 'preaccept' | 'timeout' | 'reject' | 'accept';

export interface CallEvent {
  id: string;
  chatId: string;
  from: string;
  status: CallStatus;
  isVideo: boolean;
  isGroup: boolean;
  date: Date;
}
