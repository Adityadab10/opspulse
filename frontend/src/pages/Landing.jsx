import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Leaf, Users, Truck, Shield, Phone, Mail, MapPin, ChevronRight, Sprout, Tractor, Wheat } from 'lucide-react';

const Landing = () => {
  const navigate = useNavigate();

  const handleGetStarted = () => {
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-amber-50">
      {/* Navigation */}
      <nav className="bg-white shadow-md border-b-2 border-green-600 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center space-x-3">
              <Leaf className="h-10 w-10 text-green-600" />
              <span className="text-2xl font-bold text-amber-900">AgriCorp</span>
            </div>
            <div className="hidden md:flex items-center space-x-10">
              <a href="#home" className="text-amber-800 hover:text-green-600 transition-colors text-lg font-medium">Home</a>
              <a href="#about" className="text-amber-800 hover:text-green-600 transition-colors text-lg font-medium">About</a>
              <a href="#services" className="text-amber-800 hover:text-green-600 transition-colors text-lg font-medium">Services</a>
              <a href="#contact" className="text-amber-800 hover:text-green-600 transition-colors text-lg font-medium">Contact</a>
            </div>
            <button 
              onClick={handleGetStarted}
              className="bg-green-600 text-white px-8 py-3 rounded-xl hover:bg-green-700 transition-colors text-lg font-medium">
              Get Started
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section id="home" className="relative bg-gradient-to-br from-amber-100 to-amber-200 py-24 lg:py-36 overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg width=%2260%22 height=%2260%22 viewBox=%220 0 60 60%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cg fill=%22none%22 fill-rule=%22evenodd%22%3E%3Cg fill=%22%23d97706%22 fill-opacity=%220.05%22%3E%3Cpath d=%22M30 30c0-11.046-8.954-20-20-20s-20 8.954-20 20 8.954 20 20 20 20-8.954 20-20zm15 0c0-11.046-8.954-20-20-20s-20 8.954-20 20 8.954 20 20 20 20-8.954 20-20z%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-30"></div>
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="lg:grid lg:grid-cols-2 lg:gap-16 items-center">
            <div className="mb-16 lg:mb-0">
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-amber-900 mb-8 leading-tight">
                Cultivating 
                <span className="text-green-600 block">Tomorrow's Harvest</span>
              </h1>
              <p className="text-2xl text-amber-800 mb-10 leading-relaxed font-medium">
                We provide innovative agricultural solutions that help farmers maximize yields, 
                reduce costs, and build sustainable farming practices for generations to come.
              </p>
              <div className="flex flex-col sm:flex-row gap-6">
                <button 
                  onClick={handleGetStarted}
                  className="bg-green-600 text-white px-10 py-5 rounded-xl hover:bg-green-700 transition-all transform hover:scale-105 flex items-center justify-center text-xl font-medium">
                  Start Growing <ChevronRight className="ml-3 h-6 w-6" />
                </button>
                <button className="border-3 border-green-600 text-green-700 px-10 py-5 rounded-xl hover:bg-green-600 hover:text-white transition-all text-xl font-medium">
                  Learn More
                </button>
              </div>
              <div className="flex items-center justify-center sm:justify-start space-x-12 mt-16">
                <div className="text-center">
                  <div className="text-4xl font-bold text-green-600">500+</div>
                  <div className="text-amber-700 text-lg font-medium">Happy Farmers</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-green-600">50K+</div>
                  <div className="text-amber-700 text-lg font-medium">Acres Managed</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-green-600">99%</div>
                  <div className="text-amber-700 text-lg font-medium">Success Rate</div>
                </div>
              </div>
            </div>
            
            <div className="relative">
              <div className="bg-white/90 backdrop-blur-sm rounded-3xl p-10 border-2 border-green-200 shadow-xl">
                <div className="grid grid-cols-2 gap-8">
                  <div className="bg-green-50 p-8 rounded-2xl text-center hover:bg-green-100 transition-colors border border-green-200">
                    <Sprout className="h-12 w-12 text-green-600 mx-auto mb-4" />
                    <div className="font-bold text-amber-900 text-lg">Smart Seeds</div>
                    <div className="text-amber-700 font-medium">Premium varieties</div>
                  </div>
                  <div className="bg-green-50 p-8 rounded-2xl text-center hover:bg-green-100 transition-colors border border-green-200">
                    <Tractor className="h-12 w-12 text-green-600 mx-auto mb-4" />
                    <div className="font-bold text-amber-900 text-lg">Equipment</div>
                    <div className="text-amber-700 font-medium">Modern machinery</div>
                  </div>
                  <div className="bg-green-50 p-8 rounded-2xl text-center hover:bg-green-100 transition-colors border border-green-200">
                    <Shield className="h-12 w-12 text-green-600 mx-auto mb-4" />
                    <div className="font-bold text-amber-900 text-lg">Protection</div>
                    <div className="text-amber-700 font-medium">Crop insurance</div>
                  </div>
                  <div className="bg-green-50 p-8 rounded-2xl text-center hover:bg-green-100 transition-colors border border-green-200">
                    <Wheat className="h-12 w-12 text-green-600 mx-auto mb-4" />
                    <div className="font-bold text-amber-900 text-lg">Harvest</div>
                    <div className="text-amber-700 font-medium">Maximum yield</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What Are We Section */}
      <section id="about" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-bold text-amber-900 mb-6">
              Who We Are
            </h2>
            <p className="text-2xl text-amber-700 max-w-4xl mx-auto font-medium">
              We are agricultural innovators dedicated to transforming farming through technology, 
              sustainability, and unwavering support for our farming communities.
            </p>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-20 items-center">
            <div>
              <div className="space-y-10">
                <div className="flex items-start space-x-6">
                  <div className="bg-green-100 p-4 rounded-2xl">
                    <Users className="h-8 w-8 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-amber-900 mb-3">Community First</h3>
                    <p className="text-amber-700 text-lg leading-relaxed">
                      We believe in building strong relationships with farmers and agricultural communities, 
                      providing personalized support and solutions.
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start space-x-6">
                  <div className="bg-green-100 p-4 rounded-2xl">
                    <Leaf className="h-8 w-8 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-amber-900 mb-3">Sustainable Practices</h3>
                    <p className="text-amber-700 text-lg leading-relaxed">
                      Environmental stewardship is at the core of everything we do. We promote 
                      eco-friendly farming methods that protect our planet.
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start space-x-6">
                  <div className="bg-green-100 p-4 rounded-2xl">
                    <Shield className="h-8 w-8 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-amber-900 mb-3">Proven Results</h3>
                    <p className="text-amber-700 text-lg leading-relaxed">
                      With over 15 years of experience, we've helped thousands of farmers 
                      increase productivity and profitability.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="bg-gradient-to-br from-amber-100 to-amber-200 rounded-3xl p-12 border-2 border-amber-300">
              <div className="text-center">
                <h3 className="text-3xl font-bold text-amber-900 mb-8">Our Mission</h3>
                <p className="text-xl text-amber-800 mb-12 leading-relaxed font-medium">
                  "To empower farmers with innovative solutions that increase productivity, 
                  promote sustainability, and ensure food security for future generations."
                </p>
                
                <div className="grid grid-cols-2 gap-8 mt-10">
                  <div className="text-center">
                    <div className="text-5xl font-bold text-green-600 mb-3">15+</div>
                    <div className="text-amber-700 text-lg font-medium">Years Experience</div>
                  </div>
                  <div className="text-center">
                    <div className="text-5xl font-bold text-green-600 mb-3">25</div>
                    <div className="text-amber-700 text-lg font-medium">Countries Served</div>
                  </div>
                  <div className="text-center">
                    <div className="text-5xl font-bold text-green-600 mb-3">1M+</div>
                    <div className="text-amber-700 text-lg font-medium">Acres Improved</div>
                  </div>
                  <div className="text-center">
                    <div className="text-5xl font-bold text-green-600 mb-3">95%</div>
                    <div className="text-amber-700 text-lg font-medium">Client Retention</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Our Services Section */}
      <section id="services" className="py-24 bg-amber-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-bold text-amber-900 mb-6">
              Our Services
            </h2>
            <p className="text-2xl text-amber-700 max-w-4xl mx-auto font-medium">
              Comprehensive agricultural solutions designed to meet every need of modern farming operations.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-10">
            <div className="bg-white p-10 rounded-3xl shadow-lg hover:shadow-2xl transition-all transform hover:-translate-y-2 border border-green-200">
              <div className="bg-green-100 p-5 rounded-2xl w-20 h-20 flex items-center justify-center mb-8">
                <Sprout className="h-10 w-10 text-green-600" />
              </div>
              <h3 className="text-2xl font-bold text-amber-900 mb-6">Crop Consulting</h3>
              <p className="text-amber-700 mb-8 text-lg leading-relaxed">
                Expert guidance on crop selection, planting strategies, and growth optimization 
                tailored to your specific soil and climate conditions.
              </p>
              <ul className="space-y-3 text-amber-600 font-medium">
                <li>• Soil analysis and recommendations</li>
                <li>• Crop rotation planning</li>
                <li>• Pest and disease management</li>
                <li>• Harvest timing optimization</li>
              </ul>
            </div>
            
            <div className="bg-white p-10 rounded-3xl shadow-lg hover:shadow-2xl transition-all transform hover:-translate-y-2 border border-green-200">
              <div className="bg-green-100 p-5 rounded-2xl w-20 h-20 flex items-center justify-center mb-8">
                <Tractor className="h-10 w-10 text-green-600" />
              </div>
              <h3 className="text-2xl font-bold text-amber-900 mb-6">Equipment Solutions</h3>
              <p className="text-amber-700 mb-8 text-lg leading-relaxed">
                Access to modern farming equipment and machinery through our rental, 
                lease, and purchase programs with flexible payment options.
              </p>
              <ul className="space-y-3 text-amber-600 font-medium">
                <li>• Tractors and harvesters</li>
                <li>• Irrigation systems</li>
                <li>• Precision farming tools</li>
                <li>• Maintenance and support</li>
              </ul>
            </div>
            
            <div className="bg-white p-10 rounded-3xl shadow-lg hover:shadow-2xl transition-all transform hover:-translate-y-2 border border-green-200">
              <div className="bg-green-100 p-5 rounded-2xl w-20 h-20 flex items-center justify-center mb-8">
                <Shield className="h-10 w-10 text-green-600" />
              </div>
              <h3 className="text-2xl font-bold text-amber-900 mb-6">Crop Protection</h3>
              <p className="text-amber-700 mb-8 text-lg leading-relaxed">
                Comprehensive crop insurance and protection services to safeguard 
                your investment against weather, pests, and market volatility.
              </p>
              <ul className="space-y-3 text-amber-600 font-medium">
                <li>• Weather protection coverage</li>
                <li>• Pest damage insurance</li>
                <li>• Market price guarantees</li>
                <li>• Emergency response support</li>
              </ul>
            </div>
            
            <div className="bg-white p-10 rounded-3xl shadow-lg hover:shadow-2xl transition-all transform hover:-translate-y-2 border border-green-200">
              <div className="bg-green-100 p-5 rounded-2xl w-20 h-20 flex items-center justify-center mb-8">
                <Leaf className="h-10 w-10 text-green-600" />
              </div>
              <h3 className="text-2xl font-bold text-amber-900 mb-6">Sustainable Farming</h3>
              <p className="text-amber-700 mb-8 text-lg leading-relaxed">
                Eco-friendly farming practices that improve soil health, reduce environmental 
                impact, and qualify for green incentive programs.
              </p>
              <ul className="space-y-3 text-amber-600 font-medium">
                <li>• Organic certification support</li>
                <li>• Water conservation systems</li>
                <li>• Carbon credit programs</li>
                <li>• Renewable energy integration</li>
              </ul>
            </div>
            
            <div className="bg-white p-10 rounded-3xl shadow-lg hover:shadow-2xl transition-all transform hover:-translate-y-2 border border-green-200">
              <div className="bg-green-100 p-5 rounded-2xl w-20 h-20 flex items-center justify-center mb-8">
                <Truck className="h-10 w-10 text-green-600" />
              </div>
              <h3 className="text-2xl font-bold text-amber-900 mb-6">Supply Chain</h3>
              <p className="text-amber-700 mb-8 text-lg leading-relaxed">
                Complete supply chain management from seed to market, including 
                storage, transportation, and direct buyer connections.
              </p>
              <ul className="space-y-3 text-amber-600 font-medium">
                <li>• Seed and fertilizer supply</li>
                <li>• Storage facility access</li>
                <li>• Transportation logistics</li>
                <li>• Market connection services</li>
              </ul>
            </div>
            
            <div className="bg-white p-10 rounded-3xl shadow-lg hover:shadow-2xl transition-all transform hover:-translate-y-2 border border-green-200">
              <div className="bg-green-100 p-5 rounded-2xl w-20 h-20 flex items-center justify-center mb-8">
                <Users className="h-10 w-10 text-green-600" />
              </div>
              <h3 className="text-2xl font-bold text-amber-900 mb-6">Training & Support</h3>
              <p className="text-amber-700 mb-8 text-lg leading-relaxed">
                Educational programs and ongoing support to help farmers stay updated 
                with the latest agricultural techniques and technologies.
              </p>
              <ul className="space-y-3 text-amber-600 font-medium">
                <li>• Hands-on workshops</li>
                <li>• Online training courses</li>
                <li>• 24/7 technical support</li>
                <li>• Community forums</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Contact Us Section */}
      <section id="contact" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-bold text-amber-900 mb-6">
              Get In Touch
            </h2>
            <p className="text-2xl text-amber-700 max-w-4xl mx-auto font-medium">
              Ready to transform your farming operation? Contact us today for a free consultation 
              and discover how we can help you grow better.
            </p>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-20">
            <div>
              <div className="space-y-10">
                <div className="flex items-start space-x-6">
                  <div className="bg-green-100 p-4 rounded-2xl">
                    <Phone className="h-8 w-8 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-amber-900 mb-3">Phone Support</h3>
                    <p className="text-amber-700 mb-3 text-lg">Speak with our agricultural experts</p>
                    <p className="text-green-600 font-bold text-xl">+1 (555) 123-FARM</p>
                    <p className="text-amber-600 font-medium">Mon - Fri: 7:00 AM - 7:00 PM</p>
                  </div>
                </div>
                
                <div className="flex items-start space-x-6">
                  <div className="bg-green-100 p-4 rounded-2xl">
                    <Mail className="h-8 w-8 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-amber-900 mb-3">Email Us</h3>
                    <p className="text-amber-700 mb-3 text-lg">Get detailed responses to your questions</p>
                    <p className="text-green-600 font-bold text-xl">hello@agricorp.com</p>
                    <p className="text-amber-600 font-medium">Response within 24 hours</p>
                  </div>
                </div>
                
                <div className="flex items-start space-x-6">
                  <div className="bg-green-100 p-4 rounded-2xl">
                    <MapPin className="h-8 w-8 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-amber-900 mb-3">Visit Our Office</h3>
                    <p className="text-amber-700 mb-3 text-lg">Schedule an in-person consultation</p>
                    <p className="text-green-600 font-bold text-xl">
                      123 Agricultural Drive<br />
                      Farmington, ST 12345
                    </p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="bg-amber-50 p-10 rounded-3xl border-2 border-amber-200">
              <div className="text-center mb-8">
                <h3 className="text-3xl font-bold text-amber-900 mb-4">Request Consultation</h3>
                <p className="text-lg text-amber-700">Fill out the details below and we'll get back to you within 24 hours</p>
              </div>
              
              <div className="space-y-8">
                <div className="grid md:grid-cols-2 gap-8">
                  <div>
                    <div className="text-lg font-bold text-amber-900 mb-3">First Name</div>
                    <input 
                      type="text" 
                      className="w-full px-5 py-4 rounded-xl border-2 border-amber-200 focus:ring-2 focus:ring-green-600 focus:border-green-600 outline-none transition-all text-lg"
                      placeholder="John"
                    />
                  </div>
                  <div>
                    <div className="text-lg font-bold text-amber-900 mb-3">Last Name</div>
                    <input 
                      type="text" 
                      className="w-full px-5 py-4 rounded-xl border-2 border-amber-200 focus:ring-2 focus:ring-green-600 focus:border-green-600 outline-none transition-all text-lg"
                      placeholder="Smith"
                    />
                  </div>
                </div>
                
                <div>
                  <div className="text-lg font-bold text-amber-900 mb-3">Email Address</div>
                  <input 
                    type="email" 
                    className="w-full px-5 py-4 rounded-xl border-2 border-amber-200 focus:ring-2 focus:ring-green-600 focus:border-green-600 outline-none transition-all text-lg"
                    placeholder="john@example.com"
                  />
                </div>
                
                <div>
                  <div className="text-lg font-bold text-amber-900 mb-3">Farm Size (acres)</div>
                  <input 
                    type="number" 
                    className="w-full px-5 py-4 rounded-xl border-2 border-amber-200 focus:ring-2 focus:ring-green-600 focus:border-green-600 outline-none transition-all text-lg"
                    placeholder="100"
                  />
                </div>
                
                <div>
                  <div className="text-lg font-bold text-amber-900 mb-3">Message</div>
                  <textarea 
                    rows={5}
                    className="w-full px-5 py-4 rounded-xl border-2 border-amber-200 focus:ring-2 focus:ring-green-600 focus:border-green-600 outline-none transition-all resize-none text-lg"
                    placeholder="Tell us about your farming goals and challenges..."
                  ></textarea>
                </div>
                
                <button 
                  type="button" 
                  className="w-full bg-green-600 text-white py-5 rounded-xl hover:bg-green-700 transition-colors transform hover:scale-105 font-bold text-xl"
                >
                  Send Message
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-green-700 text-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-12">
            <div>
              <div className="flex items-center space-x-3 mb-6">
                <Leaf className="h-10 w-10" />
                <span className="text-2xl font-bold">AgriCorp</span>
              </div>
              <p className="text-green-100 mb-6 text-lg">
                Cultivating tomorrow's harvest with innovative agricultural solutions.
              </p>
              <div className="flex space-x-4">
                <div className="w-12 h-12 bg-green-600 rounded-xl flex items-center justify-center hover:bg-green-500 transition-colors cursor-pointer">
                  <span className="text-lg font-bold">f</span>
                </div>
                <div className="w-12 h-12 bg-green-600 rounded-xl flex items-center justify-center hover:bg-green-500 transition-colors cursor-pointer">
                  <span className="text-lg font-bold">t</span>
                </div>
                <div className="w-12 h-12 bg-green-600 rounded-xl flex items-center justify-center hover:bg-green-500 transition-colors cursor-pointer">
                  <span className="text-lg font-bold">in</span>
                </div>
              </div>
            </div>
            
            <div>
              <h4 className="text-xl font-bold mb-6">Services</h4>
              <ul className="space-y-3 text-green-100 text-lg">
                <li><a href="#" className="hover:text-white transition-colors">Crop Consulting</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Equipment Solutions</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Crop Protection</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Supply Chain</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="text-xl font-bold mb-6">Company</h4>
              <ul className="space-y-3 text-green-100 text-lg">
                <li><a href="#" className="hover:text-white transition-colors">About Us</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Our Team</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Careers</a></li>
                <li><a href="#" className="hover:text-white transition-colors">News</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="text-xl font-bold mb-6">Contact</h4>
              <ul className="space-y-3 text-green-100 text-lg">
                <li>+1 (555) 123-FARM</li>
                <li>hello@agricorp.com</li>
                <li>123 Agricultural Drive<br />Farmington, ST 12345</li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-green-600 mt-12 pt-8 text-center text-green-200 text-lg">
            <p>&copy; 2025 AgriCorp. All rights reserved. | Privacy Policy | Terms of Service</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;