# Supabase database CA

`supabase-prod-ca-2021.crt` is Supabase's public root CA certificate. It is not
a secret and contains no private key.

- Source: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
- Subject: `C=US, ST=Delware, L=New Castle, O=Supabase Inc, CN=Supabase Root 2021 CA`
- SHA-256 fingerprint: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`
- Expires: 26 April 2031

The app requires `sslmode=verify-full` for remote production databases. Point
`sslrootcert` at this file (or the certificate downloaded from your Supabase
project's Database Settings) in both `DATABASE_URL` and `DIRECT_URL`.
