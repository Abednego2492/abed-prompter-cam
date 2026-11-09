# Abed Prompter Cam

Web app kamera + teleprompter buat rekam konten dari HP.

- Kamera depan nyala, naskah scroll di band atas (dekat lensa) biar mata tetap natap kamera.
- Tombol record → hitung mundur 3-2-1 → rekam + teleprompter jalan bareng.
- Speed, ukuran huruf, mirror, ganti kamera depan/belakang.
- Naskah tersimpan di HP (localStorage), sampai 20 naskah.
- Hasil: preview → Simpan ke Foto (share sheet) atau Download.

## Pakai
1. Buka situs di Safari (HTTPS wajib buat kamera).
2. Izinkan Kamera & Mikrofon.
3. Share → Add to Home Screen, buka dari ikon.
4. Tap **Naskah**, tempel naskah, **Pakai & tutup**, lalu tombol merah.

## Deploy
Netlify: Add new site → Import from GitHub → repo ini. Gak ada build step, publish directory `.`.
