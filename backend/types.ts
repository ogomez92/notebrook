export interface Channel {
    id: number;
    name: string;
    created_at: string;
    /** Push every new message in this channel to registered devices. */
    notify?: boolean;
}

export interface Message {
    id: number;
    channel_id: number;
    content: string;
    created_at: string;
    checked?: boolean | null;
}

export interface File {
    id: number;
    channel_id: number;
    message_id: number;
    file_path: string;
    file_type: string;
    created_at: string;
}
