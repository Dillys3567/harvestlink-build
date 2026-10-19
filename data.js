/* Sample data. Names, phone numbers and prices are made up. Ready dates are set relative to today
   so the site always shows both "Ready now" and "Upcoming" harvests. */
(function () {
  function day(offset) {
    var d = new Date();
    d.setDate(d.getDate() + offset);
    var z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  }

  window.HL_DATA = {
    version: 1,
    varieties: [
      { id: 'pectomech',  name: 'Pectomech' },
      { id: 'power-rano', name: 'Power Rano' },
      { id: 'roma',       name: 'Roma VF' },
      { id: 'local',      name: 'Local round' }
    ],
    farmers: [
      { id: 'f1', name: 'Ama Mensah',     farm: 'Mensah Family Farm',   town: 'Techiman',       region: 'Bono East',  phone: '0240000001', since: 2018, bio: 'Grows tomatoes on 4 acres with drip irrigation. Sorts and packs in clean crates.', avatar: null },
      { id: 'f2', name: 'Kwabena Owusu',  farm: 'Owusu Vegetable Farm', town: 'Tuobodom',       region: 'Bono East',  phone: '0240000002', since: 2015, bio: 'Second-generation farmer. Harvests in the early morning and delivers on request.', avatar: null },
      { id: 'f3', name: 'Akosua Boateng', farm: 'Akomadan Greens',      town: 'Akomadan',       region: 'Ashanti',    phone: '0240000003', since: 2020, bio: 'Small farm with two planting cycles a year. Happy to sell by the crate or by the truckload.', avatar: null },
      { id: 'f4', name: 'Yaw Asante',     farm: 'Asante Tomato Fields', town: 'Offinso North',  region: 'Ashanti',    phone: '0240000004', since: 2012, bio: 'Grows on rain-fed land. Prices drop for orders of 50 crates or more.', avatar: null },
      { id: 'f5', name: 'Abena Nyarko',   farm: 'Nyarko Dry-Season Farm', town: 'Navrongo',     region: 'Upper East', phone: '0240000005', since: 2019, bio: 'Irrigated dry-season tomatoes near the Tono scheme.', avatar: null },
      { id: 'f6', name: 'Issah Alhassan', farm: 'Alhassan Farms',       town: 'Pwalugu',        region: 'Upper East', phone: '0240000006', since: 2016, bio: 'Sells to traders from Accra and Kumasi. Can arrange a pick-up point on the main road.', avatar: null }
    ],
    listings: [
      { id: 'l1',  farmerId: 'f1', variety: 'pectomech',  crates: 120, price: 260, ready: day(-1), notes: 'Firm, red and sorted. Packed in plastic crates. Can load a truck on the day.', status: 'active' },
      { id: 'l2',  farmerId: 'f2', variety: 'power-rano', crates: 80,  price: 240, ready: day(0),  notes: 'Harvested this morning. Collect from the farm gate or ask about delivery.',  status: 'active' },
      { id: 'l3',  farmerId: 'f3', variety: 'roma',       crates: 45,  price: 290, ready: day(-2), notes: 'Small batch, even size, good for paste and stews.',                          status: 'active' },
      { id: 'l4',  farmerId: 'f4', variety: 'local',      crates: 200, price: 195, ready: day(1),  notes: 'Large volume. Price falls to GH¢180 for 100 crates or more.',                status: 'active' },
      { id: 'l5',  farmerId: 'f5', variety: 'pectomech',  crates: 150, price: 225, ready: day(4),  notes: 'Dry-season crop. Harvest starts in four days and runs for a week.',         status: 'active' },
      { id: 'l6',  farmerId: 'f6', variety: 'power-rano', crates: 90,  price: 235, ready: day(6),  notes: 'Pick-up point at Pwalugu junction. Can pack for long trips.',                status: 'active' },
      { id: 'l7',  farmerId: 'f1', variety: 'roma',       crates: 60,  price: 270, ready: day(9),  notes: 'Second block of the farm, one week behind the first.',                      status: 'active' },
      { id: 'l8',  farmerId: 'f2', variety: 'pectomech',  crates: 100, price: 250, ready: day(12), notes: 'Planned harvest. Reserve early to be first in line.',                       status: 'active' },
      { id: 'l9',  farmerId: 'f3', variety: 'local',      crates: 70,  price: 205, ready: day(15), notes: 'Next planting cycle.',                                                       status: 'active' },
      { id: 'l10', farmerId: 'f4', variety: 'power-rano', crates: 130, price: 230, ready: day(21), notes: 'Late-season block. Price is a guide and may change before harvest.',        status: 'active' }
    ],
    enquiries: [
      { id: 'e1', listingId: 'l1', buyer: 'Market buyer, Madina',      crates: 40, message: 'Can you hold 40 crates for Thursday morning?', date: day(-1), handled: false },
      { id: 'e2', listingId: 'l7', buyer: 'Trader, Kumasi (Kejetia)',  crates: 25, message: 'Is the price negotiable for 25 crates?',         date: day(-2), handled: false }
    ],
    sms: [], /* Text messages on the demo phone. They are added as you use the site. */
    me: 'f1' /* The farmer shown on the "My farm" page and the owner of the demo phone. */
  };
})();
