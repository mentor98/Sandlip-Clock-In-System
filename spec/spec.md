Project Name: Oasis ClockIn System

Project Overview:
A student IT Intern attendance system for Sandlip Oasis student can scan QR code to sigin or signout to either clock-in or clock-out or using the website.

How it works:
Admin portal: Admin will create the location, create the QR, update the user clocking ID, Admin can suspend account and delete users too. Admin can also chnage student IP address. Admin can chnage user map address.

Student: Student can visit websitely or urlly (i.e with phone) student can only sign in once in a day.

Registration: THe student IP address and MAC address of the phone of the laptop is save to the database. Once the user has registrar a unique is issue or created and it is tied to the MAC address and it can only work with the register MAC address. The unigue clock ID address only works on the register device. Everyday the student visit either the url or website or QR and clock in with their clocking ID. The system validate the IP/MAC address before accepting the student attendance if it pass it accept student attendance and if it fail it says "Please your not a student here". Friends or colleagues can not sign in for a particular user it is only using that particular user device by that user. Attendance is recorded in POstgreSQL, the calender and everything will be sync with the current date calender.

API: For location tracking use "OpenFree Map", for location IQ.

Barcode: Library: Bwip--js

STACK;
Frondend:
1. CSS
2. HTML
3. JavaScript

Frondend2: 
1. Svelte
2. JavaScript

Backend:
1. node.js
2. express

Database: PostgreSQL (Supabase)

