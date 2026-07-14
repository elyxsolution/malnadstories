/**
 * Travel destinations powering the cover title/location autocomplete. PURE data, no I/O.
 * Sourced from location.csv (India states/UTs + Nepal), grouped by State/UT (zone in the
 * comment). The autocomplete matches and displays each place name exactly as listed here;
 * suggestions are advisory — the cover title stays free text.
 */
export const LOCATIONS: string[] = [
  // -- Jammu & Kashmir (North) --
  'Srinagar & Dal Lake',
  'Gulmarg',
  'Pahalgam',
  'Sonmarg',
  'Amarnath Cave',
  'Vaishno Devi',
  'Yusmarg',
  'Doodhpathri',
  'Kashmir Great Lakes Trek',
  'Tarsar Marsar Trek',
  'Jammu (Raghunath Temple)',
  'Patnitop',

  // -- Ladakh (North) --
  'Leh',
  'Pangong Tso',
  'Nubra Valley',
  'Tso Moriri',
  'Khardung La',
  'Chadar Trek (Zanskar)',
  'Markha Valley Trek',
  'Magnetic Hill',
  'Hemis Monastery',
  'Zanskar Valley',
  'Kargil',

  // -- Himachal Pradesh (North) --
  'Shimla',
  'Manali',
  'Dharamshala & McLeod Ganj',
  'Spiti Valley',
  'Kasol & Parvati Valley',
  'Triund Trek',
  'Hampta Pass Trek',
  'Chandratal Lake',
  'Kullu Valley',
  'Dalhousie & Khajjiar',
  'Kinnaur Valley',
  'Bir Billing',
  'Solang Valley',
  'Jibhi & Tirthan Valley',

  // -- Uttarakhand (North) --
  'Rishikesh',
  'Haridwar',
  'Nainital',
  'Mussoorie',
  'Auli',
  'Valley of Flowers',
  'Kedarnath',
  'Badrinath',
  'Gangotri & Gaumukh',
  'Yamunotri',
  'Jim Corbett National Park',
  'Roopkund Trek',
  'Kausani',
  'Chopta & Tungnath',
  'Ranikhet',

  // -- Punjab (North) --
  'Amritsar (Golden Temple)',
  'Wagah Border',
  'Chandigarh',
  'Anandpur Sahib',
  'Patiala',

  // -- Haryana (North) --
  'Kurukshetra',
  'Sultanpur National Park',
  'Surajkund',
  'Pinjore Gardens',

  // -- Delhi (North) --
  'Red Fort',
  'Qutub Minar',
  'India Gate',
  'Humayun\'s Tomb',
  'Lotus Temple',
  'Akshardham Temple',
  'Chandni Chowk',

  // -- Rajasthan (West) --
  'Jaipur (Pink City)',
  'Udaipur',
  'Jodhpur',
  'Jaisalmer',
  'Pushkar',
  'Mount Abu',
  'Ranthambore National Park',
  'Bikaner',
  'Chittorgarh Fort',
  'Thar Desert Safari (Sam Dunes)',
  'Bundi',
  'Keoladeo National Park (Bharatpur)',

  // -- Gujarat (West) --
  'Rann of Kutch',
  'Gir National Park',
  'Somnath Temple',
  'Dwarka',
  'Statue of Unity',
  'Diu',
  'Champaner-Pavagadh',
  'Ahmedabad (Old City)',
  'Saputara',

  // -- Maharashtra (West) --
  'Mumbai',
  'Ajanta & Ellora Caves',
  'Lonavala & Khandala',
  'Mahabaleshwar',
  'Alibaug',
  'Tadoba National Park',
  'Harishchandragad Trek',
  'Kalsubai Peak Trek',
  'Sinhagad Fort Trek',
  'Shirdi',
  'Ganpatipule',
  'Tarkarli',
  'Raigad Fort',

  // -- Goa (West) --
  'Baga & Calangute Beach',
  'Anjuna & Vagator Beach',
  'Palolem Beach',
  'Old Goa Churches',
  'Dudhsagar Falls',
  'Fort Aguada',
  'Butterfly Beach & Grand Island',

  // -- Madhya Pradesh (Central) --
  'Khajuraho Temples',
  'Kanha National Park',
  'Bandhavgarh National Park',
  'Pachmarhi',
  'Sanchi Stupa',
  'Bhimbetka Caves',
  'Ujjain (Mahakaleshwar)',
  'Orchha',
  'Gwalior Fort',
  'Panna National Park',

  // -- Chhattisgarh (Central) --
  'Chitrakote Falls',
  'Kanger Valley National Park',
  'Bastar',
  'Sirpur',

  // -- Uttar Pradesh (North) --
  'Taj Mahal, Agra',
  'Agra Fort',
  'Varanasi',
  'Fatehpur Sikri',
  'Mathura & Vrindavan',
  'Ayodhya',
  'Lucknow',
  'Prayagraj (Allahabad)',
  'Sarnath',

  // -- Bihar (East) --
  'Bodh Gaya',
  'Nalanda',
  'Rajgir',
  'Patna (Golghar & Patna Sahib)',
  'Vaishali',

  // -- Jharkhand (East) --
  'Netarhat',
  'Betla National Park',
  'Hundru Falls',
  'Deoghar (Baidyanath Temple)',
  'Patratu Valley',

  // -- West Bengal (East) --
  'Darjeeling',
  'Sundarbans National Park',
  'Kolkata',
  'Kalimpong',
  'Sandakphu Trek',
  'Digha',
  'Mirik',
  'Murshidabad',

  // -- Odisha (East) --
  'Puri',
  'Konark Sun Temple',
  'Chilika Lake',
  'Bhitarkanika National Park',
  'Bhubaneswar',
  'Daringbadi',

  // -- Sikkim (East) --
  'Gangtok',
  'Tsomgo (Changu) Lake',
  'Nathu La Pass',
  'Yumthang Valley',
  'Goecha La Trek',
  'Lachung & Lachen',
  'Gurudongmar Lake',
  'Pelling',

  // -- Karnataka (South) --
  'Coorg (Kodagu)',
  'Hampi',
  'Mysuru',
  'Chikmagalur',
  'Gokarna',
  'Jog Falls',
  'Bandipur National Park',
  'Nagarhole National Park',
  'Kudremukh Trek',
  'Badami Caves',
  'Bengaluru',

  // -- Kerala (South) --
  'Munnar',
  'Alleppey (Alappuzha) Backwaters',
  'Kumarakom',
  'Kovalam Beach',
  'Varkala',
  'Thekkady (Periyar)',
  'Wayanad',
  'Kochi (Fort Kochi)',
  'Athirappilly Falls',
  'Vagamon',

  // -- Tamil Nadu (South) --
  'Ooty (Udhagamandalam)',
  'Kodaikanal',
  'Meghamalai',
  'Rameswaram',
  'Madurai (Meenakshi Temple)',
  'Mahabalipuram',
  'Kanyakumari',
  'Coonoor',
  'Mudumalai National Park',
  'Chennai (Marina Beach)',
  'Thanjavur (Brihadeeswarar Temple)',

  // -- Andhra Pradesh (South) --
  'Araku Valley',
  'Tirupati (Tirumala)',
  'Visakhapatnam (Vizag)',
  'Borra Caves',
  'Lepakshi',

  // -- Telangana (South) --
  'Hyderabad (Charminar & Golconda Fort)',
  'Ramoji Film City',
  'Warangal Fort',
  'Nagarjuna Sagar',

  // -- Puducherry (South) --
  'Puducherry (White Town)',
  'Auroville',
  'Paradise Beach',

  // -- Lakshadweep (South) --
  'Agatti Island',
  'Bangaram Island',
  'Kavaratti',

  // -- Assam (Northeast) --
  'Kaziranga National Park',
  'Majuli Island',
  'Guwahati (Kamakhya Temple)',
  'Manas National Park',
  'Sivasagar',

  // -- Meghalaya (Northeast) --
  'Cherrapunji (Sohra)',
  'Living Root Bridges (Nongriat)',
  'Shillong',
  'Dawki (Umngot River)',
  'Mawlynnong',

  // -- Arunachal Pradesh (Northeast) --
  'Tawang',
  'Ziro Valley',
  'Bomdila',
  'Sela Pass',

  // -- Nagaland (Northeast) --
  'Kohima',
  'Dzukou Valley',
  'Mon (Konyak Villages)',

  // -- Manipur (Northeast) --
  'Loktak Lake',
  'Imphal',

  // -- Mizoram (Northeast) --
  'Aizawl',
  'Vantawng Falls',

  // -- Tripura (Northeast) --
  'Ujjayanta Palace',
  'Neermahal',
  'Unakoti',

  // -- Chandigarh (North) --
  'Rock Garden',
  'Sukhna Lake',

  // -- Andaman & Nicobar Islands (Islands) --
  'Havelock Island (Swaraj Dweep)',
  'Neil Island (Shaheed Dweep)',
  'Port Blair (Cellular Jail)',
  'Ross Island (Netaji Subhas Chandra Bose Dweep)',
  'Baratang Island',

  // -- Dadra and Nagar Haveli and Daman and Diu (West) --
  'Daman Beach',
  'Silvassa',

  // -- Nepal --
  'Kathmandu Valley',
  'Everest Base Camp Trek',
  'Annapurna Base Camp Trek',
  'Annapurna Circuit Trek',
  'Pokhara & Phewa Lake',
  'Chitwan National Park',
  'Langtang Valley Trek',
  'Lumbini',
  'Mustang (Upper Mustang)',
  'Gosaikunda Lake Trek',
  'Manaslu Circuit Trek',
  'Nagarkot',
  'Bhaktapur',
  'Patan (Lalitpur)',
  'Rara Lake',
  'Ghandruk & Poon Hill',
  'Bandipur',
  'Bardia National Park',
  'Kanchenjunga Base Camp Trek',
  'Ilam',
];
