# Security Specification - Nakla Pro

## Data Invariants
1. A shipment must have a valid status ('pending' or 'approved').
2. Only authorized roles can create/update shipments.
3. 'readonly' (Omar) cannot create or update shipments, only approve them.
4. Users can only see shipments but not delete them unless they are 'admin' (Hassan).
5. Passwords in the users collection are sensitive and should only be readable by 'password_manager' or the owner themselves. (Wait, the user admin needs to see all, so password_manager can read all).

## The "Dirty Dozen" Payloads
1. **Unauthorized Create**: An anonymous user attempting to create a shipment.
2. **Identity Spoofing**: User 'Sayed' attempting to create a shipment as 'Hassan' by setting `entryUser: '1'`.
3. **Privilege Escalation**: 'Sayed' attempting to change his role to 'admin' in the users collection.
4. **Illegal Deletion**: 'Sayed' attempting to delete a shipment record.
5. **State Shortcutting**: 'Sayed' attempting to create a shipment directly with `status: 'approved'`.
6. **Shadow Fields**: Adding `isVerified: true` to a shipment document.
7. **Resource Poisoning**: A 1MB string in the `name` field of a shipment.
8. **Invalid Enum**: Setting shipment status to 'junk'.
9. **Password Theft**: 'Sayed' attempting to read 'Hassan's password from the users collection.
10. **Orphaned Record**: Creating a shipment for a non-existent date (invalid string format).
11. **Negative Money**: Setting `price: -100` in a shipment.
12. **Bypassing Review**: Updating an approved shipment's weight without resetting status to 'pending'.

## Test Runner (Logic Check)
The security rules must block all the above.
