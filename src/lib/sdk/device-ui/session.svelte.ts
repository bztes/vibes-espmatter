/**
 * Who is logged in to the device web interface (set by the shell). On devices without accounts
 * everybody who logs in is the admin.
 */
export const session = $state({ user: 'admin', admin: true });
