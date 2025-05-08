from livereload import Server, shell
 
server = Server()
server.watch('*.html', shell('echo "HTML changed"'))
server.watch('*.js', shell('echo "JS changed"'))
server.watch('*.css', shell('echo "CSS changed"'))
server.serve(root='.', port=8000) 